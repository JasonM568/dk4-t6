"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/db";
import { signIn, signOut } from "@/auth";

const registerSchema = z.object({
  name: z.string().min(1, "請輸入姓名"),
  email: z.string().email("Email 格式不正確"),
  password: z.string().min(6, "密碼至少 6 碼"),
});

export type ActionState = { error?: string; success?: boolean };

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入有誤" };
  }

  const { name, email, password } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: "此 Email 已被註冊" };

  const bronze = await prisma.membershipTier.findUnique({ where: { level: 0 } });
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      currentTierId: bronze?.id,
    },
  });

  // 註冊後直接登入
  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "註冊成功，但自動登入失敗，請手動登入" };
    }
    throw error; // redirect 會以例外形式拋出，必須往外丟
  }
  return { success: true };
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Email 或密碼錯誤" };
    }
    throw error;
  }
  return { success: true };
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}
