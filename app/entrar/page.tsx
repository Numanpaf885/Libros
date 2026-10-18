import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AuthPage from "@/components/account/AuthPage";
import LoginForm from "@/components/account/LoginForm";
import { safeNext } from "@/lib/auth/me";
import { userFromToken } from "@/lib/auth/user-session";
import { USER_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar", robots: { index: false, follow: false } };

export default async function EntrarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  if (await userFromToken((await cookies()).get(USER_COOKIE)?.value)) redirect(next);
  return <AuthPage><LoginForm next={next} /></AuthPage>;
}
