import { create } from "zustand";
import { persist } from "zustand/middleware";

// Holds the JWT + user returned by /auth/login and /auth/register.
// Persisted to localStorage ("yojan-auth") so a page refresh keeps the session.
export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: "yojan-auth" }
  )
);
