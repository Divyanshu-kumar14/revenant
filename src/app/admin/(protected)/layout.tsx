import type { ReactNode } from "react";
import { requireAdminPage } from "@/auth/gate";

// Verified: with cacheComponents, awaiting cookies() in a layout otherwise fails the build for
// every child route. This renders the whole group on demand.
export const instant = false;

/**
 * The gate lives in a layout, not in each page.tsx, so every page added under this group later,
 * starting with review/[id], inherits it without anyone remembering to add the call.
 * /admin/login sits outside the group and stays public. No wrapper element: each page renders
 * its own frame.
 */
export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return children;
}
