let accessToken = null;
let refreshPromise = null;
const base = '/api/v1';

export const fileStorageEnabled = __CLINICO_FILE_STORAGE_ENABLED__;
export const setAccessToken = (value) => { accessToken = value || null; };
export const getAccessToken = () => accessToken;

function networkError(cause) {
  const message = import.meta.env.DEV
    ? 'تعذّر الاتصال بخدمة Clinico المحلية. تأكد من أن المشروع يعمل، ثم أعد المحاولة.'
    : 'تعذّر الاتصال بخدمة Clinico. تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.';
  const error = new Error(message);
  error.code = 'API_UNREACHABLE';
  error.cause = cause;
  return error;
}

async function fetchResponse(url, options) {
  try {
    return await fetch(url, options);
  } catch (cause) {
    throw networkError(cause);
  }
}

async function readPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return { payload: await response.text(), isJson: false };
  try {
    return { payload: await response.json(), isJson: true };
  } catch {
    return { payload: null, isJson: true };
  }
}

function responseError(response, payload) {
  const fallbackMessage = import.meta.env.DEV
    ? 'تعذّر إكمال الطلب من خدمة Clinico المحلية. أعد تشغيل المشروع، وإذا استمرت المشكلة فراجع سجل API في نافذة التشغيل.'
    : 'تعذّر إكمال الطلب حاليًا. يرجى المحاولة مرة أخرى بعد قليل.';
  const error = new Error(payload?.error?.message || fallbackMessage);
  error.status = response.status;
  error.code = payload?.error?.code || 'API_RESPONSE_ERROR';
  error.fields = payload?.error?.fields;
  return error;
}

async function rawRequest(path, options = {}) {
  const fetchOptions = { ...options };
  delete fetchOptions.retry;
  const headers = new Headers(fetchOptions.headers || {});
  if (fetchOptions.body && !(fetchOptions.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetchResponse(`${base}${path}`, { ...fetchOptions, headers, credentials: 'include' });
  const { payload, isJson } = await readPayload(response);
  if (!response.ok) throw responseError(response, isJson ? payload : null);
  if (!isJson) throw responseError(response, null);
  return payload;
}

async function refreshAccess() {
  if (!refreshPromise) {
    refreshPromise = fetchResponse(`${base}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        const { payload, isJson } = await readPayload(response);
        if (!isJson || !payload?.accessToken) return null;
        setAccessToken(payload.accessToken);
        return payload;
      })
      .catch(() => null)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function api(path, options = {}) {
  try {
    return await rawRequest(path, options);
  } catch (error) {
    const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/register') || path.startsWith('/auth/refresh') || path.startsWith('/auth/forgot');
    if (error.status === 401 && !isAuthEndpoint && options.retry !== false) {
      const refreshed = await refreshAccess();
      if (refreshed) return rawRequest(path, { ...options, retry: false });
    }
    throw error;
  }
}

export async function downloadFile(path, filename) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response = await fetchResponse(`${base}${path}`, { headers, credentials: 'include' });
  if (response.status === 401) {
    const refresh = await refreshAccess();
    if (refresh) {
      headers.Authorization = `Bearer ${accessToken}`;
      response = await fetchResponse(`${base}${path}`, { headers, credentials: 'include' });
    }
  }
  if (!response.ok) {
    const { payload, isJson } = await readPayload(response);
    throw responseError(response, isJson ? payload : null);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'clinico-download';
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function uploadFile(file, { patientId, kind = 'document' } = {}) {
  if (!fileStorageEnabled) {
    const error = new Error('رفع وتنزيل الملفات الطبية متوقف مؤقتًا على هذه النسخة.');
    error.code = 'FILE_STORAGE_DISABLED';
    throw error;
  }
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  if (patientId) form.append('patientId', String(patientId));
  return api('/files', { method: 'POST', body: form });
}
