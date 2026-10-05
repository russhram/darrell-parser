document.querySelector('#login').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const result = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
  });
  if (result.ok) location.assign('/');
  else
    document.querySelector('#message').textContent =
      'Login failed. Check the local service credentials.';
});
