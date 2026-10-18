import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AccountClient from "@/components/account/AccountClient";
import AuthPage from "@/components/account/AuthPage";
import { userFromToken } from "@/lib/auth/user-session";
import { USER_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };

export default async function CuentaPage() {
  const s = await userFromToken((await cookies()).get(USER_COOKIE)?.value);
  if (!s) redirect("/entrar?next=/cuenta");
  return (
    <AuthPage wide>
      <AccountClient user={{ username: s.user.username, display_name: s.user.display_name }} />
    </AuthPage>
  );
}
