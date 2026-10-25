import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ActivateForm from "@/components/account/ActivateForm";
import AuthPage from "@/components/account/AuthPage";
import { userFromToken } from "@/lib/auth/user-session";
import { USER_COOKIE } from "@/lib/config";
import { softly } from "@/lib/soft";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activar cuenta", robots: { index: false, follow: false } };

export default async function ActivarPage() {
  if (await softly(userFromToken((await cookies()).get(USER_COOKIE)?.value), null)) redirect("/");
  return <AuthPage><ActivateForm /></AuthPage>;
}
