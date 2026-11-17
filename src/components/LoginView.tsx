import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Lock, LogIn, ShieldCheck, User } from 'lucide-react';

interface LoginViewProps {
  sessionExpiredNotice?: string | null;
  externalError?: string | null;
  onCredentialLogin: (
    username: string,
    password: string
  ) => { ok: boolean; error?: string };
  onGoogleSignIn: () => Promise<void>;
}

export function LoginView({
  sessionExpiredNotice,
  externalError,
  onCredentialLogin,
  onGoogleSignIn,
}: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const displayedError = error || externalError || null;

  const usernameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const clearCredentialInputs = useCallback(() => {
    setUsername('');
    setPassword('');
    setError(null);
    if (usernameInputRef.current) {
      usernameInputRef.current.value = '';
    }
    if (passwordInputRef.current) {
      passwordInputRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    // Clear any cached or browser-restored input values in a new window or after exit
    clearCredentialInputs();

    const handleExitOrHide = () => {
      clearCredentialInputs();
    };

    window.addEventListener('pagehide', handleExitOrHide);
    window.addEventListener('beforeunload', handleExitOrHide);
    window.addEventListener('pageshow', handleExitOrHide);

    return () => {
      window.removeEventListener('pagehide', handleExitOrHide);
      window.removeEventListener('beforeunload', handleExitOrHide);
      window.removeEventListener('pageshow', handleExitOrHide);
      // Clear last inputted values once credential verification window closes/unmounts
      clearCredentialInputs();
    };
  }, [clearCredentialInputs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = onCredentialLogin(username, password);
    if (!res.ok) {
      setError(res.error || 'Authentication failed.');
      return;
    }
    // Clear last inputted credentials immediately once verification closes
    clearCredentialInputs();
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      await onGoogleSignIn();
      clearCredentialInputs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center bg-[#F3F5F8] px-4 py-8 text-[#0B192C]">
      <div className="mx-auto w-full max-w-md rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
        {/* Top Navy Identity Banner */}
        <div className="bg-[#0B192C] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#1B3B6F] border border-[#2C528F]">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-base font-bold tracking-tight">
                City Government of Bais
              </h1>
              <p className="text-xs text-slate-300">
                Fuel Requisition & Fleet Inventory Command
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#E6EBF2] pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#334E73]">
              <ShieldCheck className="h-4 w-4 text-[#1B3B6F]" />
              <span>Authorized User Authentication</span>
            </div>
          </div>

          {sessionExpiredNotice && !displayedError && (
            <div
              role="status"
              data-testid="session-expired-notice"
              className="rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900"
            >
              {sessionExpiredNotice}
            </div>
          )}

          {displayedError && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-900"
            >
              {displayedError}
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-[#334E73] mb-1"
              >
                User Account Name or Email
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
                <input
                  ref={usernameInputRef}
                  id="login-username"
                  name="bais_account_name"
                  type="text"
                  required
                  autoComplete="off"
                  data-sensitive-clear="true"
                  placeholder="Enter assigned account name or email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-md border border-[#D5DCE6] bg-[#F9FAFC] py-2.5 pl-9 pr-3 text-sm text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-[#334E73] mb-1"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
                <input
                  ref={passwordInputRef}
                  id="login-password"
                  name="bais_account_secret"
                  type="password"
                  required
                  autoComplete="new-password"
                  data-sensitive-clear="true"
                  placeholder="Enter assigned password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-[#D5DCE6] bg-[#F9FAFC] py-2.5 pl-9 pr-3 text-sm text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 rounded-md bg-[#0B192C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1B3B6F] transition-colors"
            >
              <LogIn className="h-4 w-4" />
              <span>Sign In to System</span>
            </button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-[#E6EBF2]" />
            <span className="mx-3 shrink text-[11px] font-medium text-[#5A6F8C]">
              Live Cloud Firebase SSO
            </span>
            <div className="flex-grow border-t border-[#E6EBF2]" />
          </div>

          <button
            type="button"
            disabled={googleBusy}
            onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-[#D5DCE6] bg-white px-4 py-2.5 text-xs font-semibold text-[#0B192C] hover:bg-[#F3F5F8] disabled:opacity-50"
          >
            <LogIn className="h-4 w-4 text-[#1B3B6F]" />
            <span>{googleBusy ? 'Connecting to Google...' : 'Sign In with Google (Live Cloud)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
