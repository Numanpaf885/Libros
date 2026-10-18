import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ActivateForm from "@/components/account/ActivateForm";
import AuthPage from "@/components/account/AuthPage";
import { userFromToken } from "@/lib/auth/user-session";
import { USER_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activar cuenta", robots: { index: false, follow: false } };

export default async function ActivarPage() {
  if (await userFromToken((await cookies()).get(USER_COOKIE)?.value)) redirect("/");
  return <AuthPage><ActivateForm /></AuthPage>;
}
