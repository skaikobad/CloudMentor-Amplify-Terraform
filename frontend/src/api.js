const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || `Request failed: ${response.status}`);
  }

  return data;
}

function buildUploadUrl(uploadUrl) {
  if (uploadUrl.startsWith('http://') || uploadUrl.startsWith('https://')) {
    return uploadUrl;
  }
  return `${API_BASE_URL}${uploadUrl}`;
}

export const api = {
  health: () => request('/health'),
  summarize: (payload) => request('/summarize', { method: 'POST', body: JSON.stringify(payload) }),
  quiz: (payload) => request('/quiz', { method: 'POST', body: JSON.stringify(payload) }),
  flashcards: (payload) => request('/flashcards', { method: 'POST', body: JSON.stringify(payload) }),
  studyPlan: (payload) => request('/study-plan', { method: 'POST', body: JSON.stringify(payload) }),
  history: () => request('/history?limit=10'),
  saveProgress: (payload) => request('/save-progress', { method: 'POST', body: JSON.stringify(payload) }),
  createUploadUrl: (payload) => request('/upload-url', { method: 'POST', body: JSON.stringify(payload) }),
  processFile: (payload) => request('/process-file', { method: 'POST', body: JSON.stringify(payload) }),
  uploadFile: async (upload, file) => {
    const response = await fetch(buildUploadUrl(upload.uploadUrl), {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || data.error || `Upload failed: ${response.status}`);
    }

    if (upload.mode === 'local') {
      return response.json();
    }

    return { uploaded: true };
  }
};
