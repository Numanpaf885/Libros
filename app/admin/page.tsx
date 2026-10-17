import AdminApp from "@/components/admin/AdminApp";
import { SITE_NAME } from "@/lib/site";

export const metadata = { title: "Administración", robots: { index: false } };
export default function AdminPage() {
  return <AdminApp siteName={SITE_NAME} />;
}
