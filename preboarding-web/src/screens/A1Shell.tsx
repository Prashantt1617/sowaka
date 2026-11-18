// The signed-in mobile-web page (18 Nov design, "Mobile web · the pre-boarding link"):
// the company header with the candidate's email, the screen, and the footer (Help with
// Sign out, Privacy, Write to HR).
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { portal } from '../api/portal';
import { A1Frame, WebFooter, WebHeader } from '../components/A1';
import { useMe } from '../session';

export function WebPage({ children, footer = true, white }: { children: ReactNode; footer?: boolean; white?: boolean }) {
  const { me, subject } = useMe();
  const navigate = useNavigate();
  const signOut = () => { portal.signOut(); navigate('/sign-in', { replace: true }); };
  return (
    <A1Frame white={white}>
      <WebHeader company={me.company} email={me.personalEmail} />
      <main id="main" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</main>
      {footer && <WebFooter hr={me.hrContact} onSignOut={signOut} subject={subject} />}
    </A1Frame>
  );
}
