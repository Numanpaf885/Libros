import AdminApp from "@/components/admin/AdminApp";
import { LegalLinks } from "@/components/layout/SiteFooter";
import { SITE_NAME } from "@/lib/site";

export const metadata = { title: "Administración", robots: { index: false } };
export default function AdminPage() {
  return (
    <>
      <AdminApp siteName={SITE_NAME} />
      <footer className="mt-auto border-t border-line text-sm text-muted" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <LegalLinks className="mx-auto w-full max-w-[1200px] px-3 py-2 sm:px-5" />
      </footer>
    </>
  );
}
