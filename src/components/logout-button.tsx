"use client";

import { logoutAction } from "@/actions/auth";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="text-sm text-gray-600 transition hover:text-black"
      >
        登出
      </button>
    </form>
  );
}
