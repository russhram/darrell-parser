(async () => {
  const message = document.querySelector('#message');
  const session = await fetch('/api/session').then((r) => r.json());
  let discoveryId;
  let stream;
  const node = (tag, text) => {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  };
  const request = async (path, data) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
      body: JSON.stringify(data || {}),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'Request failed');
    return body;
  };
  const action = (title, handler) => {
    const b = node('button', title);
    b.addEventListener('click', () =>
      handler().catch((e) => {
        message.textContent = e.message;
      }),
    );
    return b;
  };
  function follow(id) {
    stream?.close();
    stream = new EventSource(`/api/jobs/${id}/events`);
    stream.addEventListener('progress', (event) => {
      const job = JSON.parse(event.data);
      message.textContent = `${job.state}: ${job.message}`;
      load();
      if (job.state === 'awaiting_scope') showScope(job);
      if (['awaiting_scope', 'completed', 'partial', 'failed', 'cancelled'].includes(job.state))
        stream.close();
    });
  }
  function showScope(job) {
    discoveryId = job.id;
    document.querySelector('#scope').hidden = false;
    const inventory = document.querySelector('#inventory');
    inventory.replaceChildren();
    for (const item of job.inventory.items) {
      const label = node('label', '');
      label.style.display = 'block';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.id;
      input.name = 'scope';
      label.append(
        input,
        document.createTextNode(` ${item.title.nl || item.title.en} (${item.kind})`),
      );
      inventory.append(label);
    }
    for (const limitation of job.inventory.limitations) inventory.append(node('p', limitation));
  }
  async function load() {
    const jobs = await fetch('/api/jobs').then((r) => r.json());
    const container = document.querySelector('#jobs');
    container.replaceChildren();
    for (const job of jobs) {
      const row = node('article', '');
      row.append(
        node('h3', `${job.id} · ${job.state}`),
        node('p', `${job.message} · ${job.sections.length} saved sections`),
      );
      if (job.report) {
        const link = node('a', 'Open viewer');
        link.href = `/view/${job.id}/`;
        row.append(link, document.createTextNode(' · '));
        const zip = node('a', 'Download ZIP');
        zip.href = `/api/jobs/${job.id}/export`;
        row.append(zip);
      }
      if (document.body.dataset.mode === 'extract') {
        if (job.state === 'awaiting_scope')
          row.append(action('Choose scope', async () => showScope(job)));
        if (['cancelled', 'partial', 'failed', 'needs_user_action'].includes(job.state))
          row.append(
            action('Resume', async () => {
              await request(`/api/jobs/${job.id}/resume`);
              follow(job.id);
            }),
          );
        else if (!['completed', 'awaiting_scope'].includes(job.state))
          row.append(
            action('Cancel', async () => {
              await request(`/api/jobs/${job.id}/cancel`);
              await load();
            }),
          );
      }
      container.append(row);
    }
  }
  document.querySelector('#logout').addEventListener('click', async () => {
    await request('/auth/logout');
    location.assign('/login');
  });
  document.querySelector('#discover')?.addEventListener('click', async () => {
    try {
      const job = await request('/api/discover');
      follow(job.id);
      await load();
    } catch (e) {
      message.textContent = e.message;
    }
  });
  document.querySelector('#extract')?.addEventListener('click', async () => {
    try {
      if (!document.querySelector('#text-permission').checked)
        throw new Error(
          'Confirm text reproduction permission. Notes are not implemented in this iteration.',
        );
      const selectedIds = [...document.querySelectorAll('input[name="scope"]:checked')].map(
        (i) => i.value,
      );
      const job = await request('/api/jobs', {
        discoveryId,
        selectedIds,
        options: {
          textMode: 'authorized_verbatim',
          textPermission: 'authorized',
          imagePermission: document.querySelector('#image-permission').checked
            ? 'authorized'
            : 'unknown',
          languages: ['nl', 'en'],
          answerPolicy: 'visible_only',
        },
      });
      follow(job.id);
      await load();
    } catch (e) {
      message.textContent = e.message;
    }
  });
  await load();
})();
