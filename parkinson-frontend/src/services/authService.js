import { request, setToken, clearToken } from "./api";

export function registerUser({ name, email, password }) {
  return request("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export async function loginUser({ email, password }) {
  const data = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.access_token);
  return data;
}

export function getMe() {
  return request("/api/v1/auth/me");
}

export function logoutUser() {
  clearToken();
}