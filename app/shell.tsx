"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./lib/api";
import type { AuthMe } from "./lib/types";
import { Icon } from "./lib/ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: "grid", badge: null as "issues" | "invoices" | null },
  { href: "/podcasts", label: "Podcasts", icon: "pulse", badge: null },
  { href: "/episodes", label: "Episodes", icon: "mic", badge: null },
  { href: "/campaigns", label: "Campaigns", icon: "mic", badge: null },
  { href: "/issues", label: "Issues", icon: "alert", badge: "issues" as const },
  { href: "/alerts", label: "Alerts", icon: "flag", badge: null },
  { href: "/invoices", label: "Invoices", icon: "file", badge: "invoices" as const },
  { href: "/advertisers", label: "Advertisers", icon: "dollar", badge: null },
  { href: "/reports", label: "Reports", icon: "flag", badge: null },
  { href: "/integrations", label: "Integrations", icon: "shield", badge: null },
  { href: "/settings", label: "Settings", icon: "grid", badge: null },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [badgeIssues, setBadgeIssues] = useState<number | null>(null);
  const [badgeInvoices, setBadgeInvoices] = useState<number | null>(null);
  const [me, setMe] = useState<AuthMe | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [issues, ready, meRes] = await Promise.all([
          api.issues({ resolved: "false", pageSize: 1 }),
          api.campaigns({ ready: "true", pageSize: 1 }),
          api.me(),
        ]);
        if (cancelled) return;
        setBadgeIssues(issues.total);
        setBadgeInvoices(ready.total);
        setMe(meRes);
      } catch {
        /* sidebar badges and identity are decorative */
      }
    };
    void load();
    const iv = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [pathname]);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.logout();
    } catch {
      /* clear locally regardless */
    }
    setMe(null);
    router.replace("/login");
  };

  return (
    <div className="sl-root">
      <div className="sl-shell">
        <aside className="sl-sidebar">
          <div className="sl-brand">
            <span className="sl-logo"><Icon name="pulse" /></span>
            <div>
              <h1 className="sl-title">Signal<span>Ledger</span></h1>
              <p className="sl-tagline">Podcast ad reconciliation</p>
            </div>
          </div>
          <nav className="sl-nav" aria-label="Main navigation">
            <span className="sl-nav-label">Workspace</span>
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const badgeValue = item.badge === "issues" ? badgeIssues : item.badge === "invoices" ? badgeInvoices : null;
              return (
                <Link key={item.href} href={item.href} className={active ? "sl-nav-active" : ""} aria-current={active ? "page" : undefined}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {badgeValue != null && badgeValue > 0 ? <span className="sl-nav-count">{badgeValue}</span> : null}
                </Link>
              );
            })}
          </nav>
          <div className="sl-sidebar-foot">
            {me ? (
              <div className="sl-user">
                <span className="sl-user-avatar">{(me.user.name || me.user.email || "?").slice(0, 1).toUpperCase()}</span>
                <div className="sl-user-meta">
                  <span className="sl-user-name">{me.user.name || me.user.email}</span>
                  <span className="sl-user-org">{me.organization.name}</span>
                </div>
                <button className="sl-iconbtn" onClick={() => void logout()} disabled={loggingOut} aria-label="Sign out" title="Sign out">
                  <Icon name="close" />
                </button>
              </div>
            ) : null}
            <span className="sl-sync">
              <span className="sl-live-dot" />
              <span className="sl-sync-text">API connected</span>
            </span>
          </div>
        </aside>
        <div className="sl-content">{children}</div>
      </div>
    </div>
  );
}
