import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import Link from "next/link";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const params = await searchParams;
  if (!params.token) return <main className="simple-page"><section className="auth-card compact"><div className="auth-logo"><span>🏪</span><strong>Mini Market</strong></div><h1>Enlace no válido</h1><p className="muted">El enlace ha expirado o ya fue utilizado. Solicita uno nuevo desde la pantalla de acceso.</p><Link className="primary-button center" href="/">Volver al inicio</Link></section></main>;
  return <ResetPasswordForm token={params.token} />;
}
