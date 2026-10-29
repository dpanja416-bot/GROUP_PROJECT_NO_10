const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const TOKEN_KEY = "access_token";

export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (token) => sessionStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

function extractMessage(data, status) {
  if (status === 429) return "Too many attempts. Please try again later.";
  if (typeof data === "string") return data || `HTTP ${status}`;
  const detail = data?.detail ?? data?.error ?? data?.message ?? data?.msg;
  if (Array.isArray(detail)) return detail.map((e) => e.msg).join(", ");
  return detail || `HTTP ${status}`;
}

export async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  // Token expired or invalid: log out
  if (response.status === 401 && token) {
    clearToken();
    window.dispatchEvent(new Event("auth:logout"));
  }

  if (!response.ok) {
    throw new Error(extractMessage(data, response.status));
  }

  return data;
}

export function getScanHistory() {
  return request("/api/history");
}

export function predictMRI(file, patientId = "") {
  const formData = new FormData();
  formData.append("file", file);

  if (patientId.trim()) {
    formData.append("patient_id", patientId.trim());
  }

  return request("/api/predict", {
    method: "POST",
    body: formData,
  });
}

export { API_BASE_URL };