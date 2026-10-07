// Every page uses this instead of calling fetch()+res.json() directly.
// Reason: if the server (or Replit itself) ever answers with something
// that isn't JSON -- an HTML error page, a 404 from the platform, a
// timeout page -- calling res.json() straight on that throws a raw
// "Unexpected token '<'... is not valid JSON" error that's meaningless
// to anyone looking at it. This wraps that so people always see a plain
// sentence about what went wrong instead.

async function apiFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    const err = new Error('Could not reach the server. Check your connection and try again.');
    err.status = 0;
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  let data = null;

  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (parseErr) {
      const err = new Error('The server sent back a response we could not read. Please try again.');
      err.status = res.status;
      throw err;
    }
  }

  if (!res.ok) {
    let message;
    if (data && data.error) {
      message = data.error;
    } else if (res.status === 404) {
      message = 'That request could not be found (404). If the app just started up, wait a few seconds and try again.';
    } else if (res.status === 401) {
      message = 'You need to sign in again.';
    } else if (res.status === 413) {
      message = 'That file is too large.';
    } else {
      message = `Something went wrong (status ${res.status}). Please try again.`;
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return data;
}

// Convenience wrapper for the common case: JSON body in, JSON body out.
function apiFetchJSON(url, method, body) {
  return apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
