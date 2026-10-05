(() => {
  const select = document.querySelector('#language');
  function language(value) {
    if (!['nl', 'en', 'both'].includes(value)) value = 'nl';
    document.documentElement.dataset.language = value;
    document.documentElement.lang = value === 'both' ? 'nl' : value;
    select.value = value;
    try {
      localStorage.setItem('study-language', value);
    } catch {}
  }
  let initial = 'nl';
  try {
    initial = localStorage.getItem('study-language') || 'nl';
  } catch {}
  language(initial);
  select.addEventListener('change', () => language(select.value));
  document.querySelector('#search').addEventListener('input', (e) => {
    const query = e.target.value.toLocaleLowerCase();
    document.querySelectorAll('[data-search]').forEach((section) => {
      section.hidden = !section.textContent.toLocaleLowerCase().includes(query);
    });
  });
  document.querySelector('#print').addEventListener('click', () => window.print());
  document.querySelector('#print-answers').addEventListener('change', (e) => {
    document.documentElement.classList.toggle('print-answers', e.target.checked);
  });
})();
