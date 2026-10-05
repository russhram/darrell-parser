import { createServer, type Server } from 'node:http';
export const bookId = '11111111-1111-1111-1111-111111111111';
export const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJAAAAABJRU5ErkJggg==',
  'base64',
);
export async function platform() {
  const counts = { submitted: 0, reads: 0 };
  const server: Server = createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    if (path === '/login' && req.method === 'POST') {
      res.writeHead(302, {
        'Set-Cookie': 'school=fixture; Path=/',
        Location: `/se/content/book/${bookId}`,
      });
      res.end();
      return;
    }
    if (path === '/login') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<html lang="nl"><form method="post"><input name="username" autocomplete="username"><input type="password" name="password"><button>Inloggen</button></form></html>',
      );
      return;
    }
    if (path === '/submit') {
      counts.submitted++;
      res.end('not allowed');
      return;
    }
    if (path === '/image.png') {
      if (!req.headers.cookie?.includes('school=fixture')) {
        res.setHeader('Content-Type', 'text/html');
        res.end('Login');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
      res.end(png);
      return;
    }
    if (path === '/fake.png') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('login HTML');
      return;
    }
    if (path === '/ebook') {
      res.end('<html><main data-ebook-reader>Reader</main></html>');
      return;
    }
    if (!req.headers.cookie?.includes('school=fixture')) {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
    counts.reads++;
    const current = path.endsWith('/summary')
      ? 'summary'
      : path.endsWith('/theory')
        ? 'theory'
        : 'book';
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html lang="nl"><head><meta charset="utf-8"></head><body><header><select aria-label="Language"><option value="nl">Nederlands</option><option value="en">English</option></select></header><nav data-course-menu><div data-chapter-id="chapter-1"><a href="/se/content/book/${bookId}/theory" id="theory-link">Theorie</a><a href="/se/content/book/${bookId}/summary" id="summary-link">Samenvatting</a></div></nav><main data-learning-content></main><script>
    const current = ${JSON.stringify(current)};
    const content = {
      nl: { title: 'Watersystemen', paragraph: 'Een rivier stroomt naar de zee. Water is belangrijk.', question: 'Waar stroomt de rivier naartoe? Zie bron 1.', option: 'De zee', answer: 'Naar de zee', summary: 'Samenvatting', row: 'Rivier', caption: 'Bron 1: rivierkaart' },
      en: { title: 'Water systems', paragraph: 'A river flows to the sea. Water is important.', question: 'Where does the river flow? See source 1.', option: 'The sea', answer: 'To the sea', summary: 'Summary', row: 'River', caption: 'Source 1: river map' }
    };
    function render(lang) {
      document.documentElement.lang = lang;
      const c = content[lang];
      document.querySelector('#summary-link').textContent = c.summary;
      document.querySelector('#theory-link').textContent = lang === 'nl' ? 'Theorie' : 'Theory';
      document.querySelector('main').innerHTML = '<h1 data-id="title">' + c.title + '</h1><p data-id="paragraph">' + (current === 'summary' ? c.summary : c.paragraph) + '</p><table data-id="table"><tr><th>' + c.row + '</th><th>km</th></tr><tr><td>Rijn</td><td>1230</td></tr></table>' + (current === 'summary' ? '' : '<article data-question-id="question-42" data-number="Q1.1.1"><p data-prompt>' + c.question + '</p><div data-subpart data-id="a">' + c.question + '</div><label data-option-id="A"><input type="radio" name="q">' + c.option + '</label><input name="student" value="private-student-answer"><button data-submit>Check</button><div data-answer>' + c.answer + '</div><div data-feedback>feedback</div><div data-answer hidden>hidden reference</div></article><figure data-source-id="1" data-attribution="Fixture"><img src="/image.png" alt="map"><figcaption>' + c.caption + '</figcaption></figure>');
    }
    document.addEventListener('click', e => { if (e.target.matches('[data-submit]')) fetch('/submit', {method: 'POST'}); });
    document.querySelector('select').addEventListener('change', e => render(e.target.value));
    setTimeout(() => render('nl'), 30);
    </script></body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    counts,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
