import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page, Frame } from 'playwright';
import type { Config } from '../config.js';
import { bookUrl } from '../config.js';
import { NetworkPolicy, safeUrl, sha } from '../security.js';
import type { Inventory, InventoryItem, Language } from '../model.js';

export interface Profile {
  version: string;
  contentOrigins: string[];
  ssoOrigins: string[];
  assetOrigins: string[];
  credentialOrigins: string[];
  main: string;
  menu: string;
  question: string;
  tabs: string;
  ebook: string;
  ready: string;
}
export async function profile(c: Config): Promise<Profile> {
  const p = JSON.parse(
    await readFile(new URL('../../profiles/noordhoff.json', import.meta.url), 'utf8'),
  ) as Profile;
  if (c.testOrigin) {
    p.contentOrigins = p.ssoOrigins = p.assetOrigins = p.credentialOrigins = [c.testOrigin];
  }
  if (c.schoolLoginOrigin) {
    p.ssoOrigins.push(c.schoolLoginOrigin);
    p.credentialOrigins.push(c.schoolLoginOrigin);
  }
  return p;
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class NoordhoffAdapter {
  constructor(
    public page: Page,
    public context: BrowserContext,
    public p: Profile,
    public c: Config,
  ) {}
  async guardSource() {
    if (/\/ebook(?:\/|$)/i.test(this.page.url()) || (await this.page.locator(this.p.ebook).count()))
      throw new Error('unsupported_ebook');
    const text = await this.page.locator('body').innerText();
    if (/Toegang verboden|verkeer vanaf uw adres geblokkeerd/i.test(text))
      throw new Error('access_blocked_403');
    // A reader may have no /ebook route at all.
    if (
      (await this.page
        .getByRole('button', { name: /^(Volgende pagina|Vorige pagina|Next page|Previous page)$/i })
        .count()) &&
      (await this.page.locator('canvas, [data-page-number]').count())
    )
      throw new Error('unsupported_ebook');
  }
  async courseReady() {
    const u = new URL(this.page.url());
    if (
      u.origin !== new URL(bookUrl(this.c)).origin ||
      !u.pathname.startsWith(`/se/content/book/${this.c.bookId}`)
    )
      return false;
    return await this.page
      .locator(this.p.ready)
      .first()
      .isVisible()
      .catch(() => false);
  }
  async authenticate(onAction: (message: string) => void, cancelled: () => boolean) {
    await this.page.goto(bookUrl(this.c), { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(800);
    await this.guardSource();
    if (await this.courseReady()) return;
    const entree = this.page.getByRole('button', { name: /^via Entree$/i });
    if (await entree.isVisible()) {
      await entree.click();
      await this.page.locator('#wayf_search').waitFor({ timeout: 30000 });
    }
    const search = this.page.locator('#wayf_search');
    if (await search.isVisible()) {
      // SECONDARY uses the school-account / Magister route, never Basispoort.
      const group = this.page.locator('select[name="schoolGroup"], select#school-group');
      if (await group.count()) await group.selectOption(this.c.schoolGroup);
      await search.fill(this.c.schoolName);
      await search.click();
      const escaped = this.c.schoolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const choice = this.page.getByRole('button', {
        name: new RegExp(`^Inloggen met ${escaped}(?:\\s|$)`, 'i'),
      });
      await choice.first().waitFor({ timeout: 30000 });
      if ((await choice.count()) !== 1)
        throw new Error('School selection ambiguous; refine SCHOOL_NAME');
      await choice.click();
      await this.page.waitForTimeout(800);
    }
    const deadline = Date.now() + Math.min(this.c.maxMinutes * 60000, 10 * 60000);
    let filledUser = false,
      filledPassword = false,
      notified = false;
    while (!cancelled() && Date.now() < deadline) {
      await this.guardSource();
      if (await this.courseReady()) return;
      const origin = new URL(this.page.url()).origin;
      if (this.p.credentialOrigins.includes(origin)) {
        const user = this.page
          .locator(
            'input[autocomplete="username"], input[name="username"], input[name="UserName"], input#username, input#usernameInput',
          )
          .first();
        const pass = this.page.locator('input[type="password"]').first();
        if (!filledUser && (await user.isVisible())) {
          await user.fill(this.c.username);
          filledUser = true;
          if (!(await pass.isVisible())) {
            const next = this.page.getByRole('button', { name: /^(Volgende|Next|Verder)$/i });
            if ((await next.count()) === 1) await next.click();
          }
        }
        if (!filledPassword && (await pass.isVisible())) {
          await pass.fill(this.c.password);
          filledPassword = true;
          const submit = this.page.getByRole('button', {
            name: /^(Inloggen|Log in|Sign in|Aanmelden)$/i,
          });
          if ((await submit.count()) === 1) await submit.click();
        }
      }
      if (!notified) {
        onAction(
          this.c.headless
            ? 'Login requires a visible browser. Set HEADLESS=false and resume.'
            : 'Complete SSO/MFA in the Chromium window. Credentials are entered only on trusted school origins.',
        );
        notified = true;
      }
      await pause(500);
    }
    throw new Error(cancelled() ? 'cancelled' : 'needs_user_action');
  }
  async language(lang: Language): Promise<boolean> {
    // Only explicit site language controls are touched. Exercise controls are never used.
    const selectors = this.page.locator(
      'select[aria-label="Language"], select[aria-label="Taal"], select[data-language-switch]',
    );
    const before = await this.page
      .locator(this.p.main)
      .first()
      .innerText()
      .catch(() => '');
    const previousLang = await this.page.locator('html').getAttribute('lang');
    const previousControl = await selectors
      .first()
      .inputValue()
      .catch(() => '');
    let changed = false;
    if ((await selectors.count()) === 1) {
      const value = await selectors.locator('option').evaluateAll((nodes, code) => {
        const option = nodes.find(
          (n) =>
            (n as HTMLOptionElement).value.toLowerCase() === code ||
            new RegExp(code === 'en' ? 'English|Engels' : 'Nederlands|Dutch', 'i').test(
              n.textContent || '',
            ),
        );
        return option ? (option as HTMLOptionElement).value : null;
      }, lang);
      if (value) {
        await selectors.selectOption(value);
        changed = previousControl !== value;
      }
    } else {
      const control = this.page.getByRole('button', {
        name: lang === 'nl' ? /^(Nederlands|Dutch|NL)$/i : /^(English|Engels|EN)$/i,
      });
      if ((await control.count()) === 1 && (await control.isVisible())) {
        await control.click();
        changed = true;
      }
    }
    if (changed) {
      await this.page
        .waitForFunction(
          ({ main, before, lang, previousLang }) => {
            const text = (document.querySelector(main) as HTMLElement | null)?.innerText || '';
            return (
              (text !== before && text.length > 0) ||
              (document.documentElement.lang !== previousLang &&
                document.documentElement.lang.startsWith(lang))
            );
          },
          { main: this.p.main, before, lang, previousLang },
          { timeout: 15000 },
        )
        .catch(() => {});
    }
    const currentLang = await this.page.locator('html').getAttribute('lang');
    const after = await this.page
      .locator(this.p.main)
      .first()
      .innerText()
      .catch(() => '');
    // A selected UI language alone does not prove that the study text changed.
    return (
      currentLang?.startsWith(lang) === true &&
      (!changed || after !== before || previousLang?.startsWith(lang) === true)
    );
  }
  async discover(): Promise<Inventory> {
    await this.guardSource();
    const items: InventoryItem[] = [];
    const seen = new Set<string>();
    let title = { nl: null as string | null, en: null as string | null };
    for (const lang of ['nl', 'en'] as const) {
      if (!(await this.language(lang))) continue;
      title[lang] = await this.page
        .locator('h1')
        .first()
        .innerText()
        .catch(() => 'Book');
      // Explicit menu expanders only, no task buttons or generic click loop.
      const expanders = this.page
        .locator(this.p.menu)
        .locator('button[aria-expanded="false"][aria-controls]');
      for (let i = 0; i < Math.min(await expanders.count(), 100); i++) {
        const b = expanders.first();
        if (await b.count()) await b.click();
      }
      const entries = await this.page
        .locator(this.p.menu)
        .locator('a[href], [role="tab"][data-content-id], [role="tab"][data-item-id]')
        .evaluateAll((nodes) =>
          nodes.map((n) => {
            const chapter = n.closest('[data-chapter-id]');
            return {
              href: (n as HTMLAnchorElement).href || '',
              key: n.getAttribute('data-content-id') || n.getAttribute('data-item-id') || '',
              title: (n as HTMLElement).innerText,
              chapter: chapter?.getAttribute('data-chapter-id') || '',
              parent: n.closest('[data-parent-id]')?.getAttribute('data-parent-id') || null,
            };
          }),
        );
      for (const entry of entries) {
        const url = entry.href || this.page.url();
        const u = new URL(url);
        if (
          u.origin !== new URL(bookUrl(this.c)).origin ||
          !u.pathname.startsWith(`/se/content/book/${this.c.bookId}`) ||
          /\/ebook\b/i.test(url)
        )
          continue;
        if (!entry.title.trim()) continue;
        const id = 'item-' + sha(entry.key || safeUrl(url)).slice(0, 16);
        const existing = items.find((i) => i.id === id);
        if (existing) {
          existing.title[lang] = entry.title;
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        const kind = /samenvatting|summary|at a glance/i.test(entry.title)
          ? 'summary'
          : /opdracht|assignment|exercise|challenge|support/i.test(entry.title)
            ? 'exercise'
            : 'theory';
        items.push({
          id,
          parentId: entry.parent,
          title: { nl: null, en: null, [lang]: entry.title },
          kind,
          chapterId: entry.chapter || 'chapter-unknown',
          order: items.length,
          url: safeUrl(url),
          ...(entry.key
            ? {
                locator: `[role="tab"][data-content-id="${entry.key.replace(/[^\w-]/g, '')}"], [role="tab"][data-item-id="${entry.key.replace(/[^\w-]/g, '')}"]`,
              }
            : {}),
        });
      }
    }
    const reliable = items.length > 0 && items.every((i) => i.chapterId !== 'chapter-unknown');
    return {
      schemaVersion: '1.0',
      bookId: this.c.bookId,
      title,
      items,
      reliable,
      limitations: reliable
        ? []
        : [
            'adapter_required: independent chapter/question inventory has not been verified for this course.',
          ],
    };
  }
  async open(item: InventoryItem) {
    if (item.locator) {
      await this.page.goto(bookUrl(this.c), { waitUntil: 'domcontentloaded' });
      await this.page.locator(item.locator).first().waitFor();
      await this.page.locator(item.locator).first().click();
    } else await this.page.goto(item.url, { waitUntil: 'domcontentloaded' });
    await this.page.locator(this.p.main).first().waitFor({ state: 'visible', timeout: 30000 });
    await this.guardSource();
    if (!(await this.courseReady())) throw new Error('session_expired');
  }
  async frames(): Promise<Frame[]> {
    return this.page.frames().filter((f) => {
      try {
        return this.p.contentOrigins.includes(new URL(f.url()).origin);
      } catch {
        return false;
      }
    });
  }
}
export async function restrictBrowser(context: BrowserContext, p: Profile, c: Config) {
  const policy = new NetworkPolicy(
    [...new Set([...p.contentOrigins, ...p.ssoOrigins, ...p.assetOrigins])],
    c.testOrigin,
  );
  await context.route('**/*', async (route) => {
    try {
      await policy.check(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
  return policy;
}
