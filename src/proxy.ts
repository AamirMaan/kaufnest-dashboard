import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessRoute } from "@/lib/utils/permissions";
import { createControlClient } from "@/lib/supabase/control";
import type { UserRole } from "@/types";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/login");
  const isDashboardRoute = pathname.startsWith("/dashboard");

  // Redirect unauthenticated users to login
  if (!user && isDashboardRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // RBAC: check route-level permissions
  if (user && isDashboardRoute) {
    const tenantSchema =
      (user.app_metadata?.tenant_schema as string | undefined) ?? "public";

    // Block deactivated tenants before any RBAC check
    const control = createControlClient();
    const { data: tenantRow } = await control
      .schema("control")
      .from("tenants")
      .select("status")
      .eq("schema_name", tenantSchema)
      .single<{ status: string }>();

    // Fail-open: if control plane is unreachable or tenant row missing,
    // tenantRow is null and the check passes — user proceeds to RBAC.
    if (tenantRow?.status === "deactivated") {
      const url = request.nextUrl.clone();
      url.pathname = "/account-deactivated";
      return NextResponse.redirect(url);
    }

    const { data: profile } = await supabase
      .schema(tenantSchema)
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = (profile?.role ?? "accountant") as UserRole;

    if (!canAccessRoute(role, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/", "/dashboard", "/dashboard/:path*", "/login"],
};
