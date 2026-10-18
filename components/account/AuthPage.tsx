import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import { SITE_NAME } from "@/lib/site";

/** Same translucent header and footer as the rest of the site, with the content centred in a card. */
export default function AuthPage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <SiteHeader siteName={SITE_NAME} />
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className={`w-full ${wide ? "max-w-2xl" : "max-w-sm"}`}>{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
