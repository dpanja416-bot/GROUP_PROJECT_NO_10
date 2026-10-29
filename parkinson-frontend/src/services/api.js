
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000"
).replace(/\/+$/, "");

async function request(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
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

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null
        ? data.error || data.message || data.msg
        : data;

    throw new Error(message || `HTTP ${response.status}`);
  }

  return data;
}

export function getScanHistory() {
  return request("/api/history");
}

export function predictMRI(file, patientId = "") {
  const formData = new FormData();

  // Must match the field name expected by Flask.
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
