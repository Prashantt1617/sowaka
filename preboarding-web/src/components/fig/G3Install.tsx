// Web · 4 Home once HR generates app access (Figma 4967:94069), web-only: the app has no install
// prompt. The preview (the Sowaka Connect icon, name and phone) is the frame's own illustration,
// exported from node 4999:55 at 2x. Wire-up: on the web home, when me.view === 'joined'
// (HR generated app access), render <G3Install workEmail={me.workEmail} /> in place of the tiles.
import { useCopy, useFocusHeading } from '../../lib/hooks';
import { APP_LINK } from '../../lib/links';
import appPreview from '../../assets/fig/g3-app-preview@2x.png';
import { FigPage } from './FigShell';
import { FigCheck } from './icons';
import { G3Copy, G3Download20 } from './icons/g3-icons';
import { G3WebBottom, G3WebTop } from './G3WebShell';

export function G3Install({ workEmail }: { workEmail?: string }) {
  const [copied, copy] = useCopy();
  const h1 = useFocusHeading<HTMLHeadingElement>('g3-install');
  return (
    <FigPage surface>
      <G3WebTop />
      <main id="main" className="g3-main">
        <section className="g3-install" aria-label="Install the Sowaka Connect app">
          <img className="g3-install__preview" src={appPreview} alt="The Sowaka Connect app" width={353} height={228} />
          <div className="g3-install__intro">
            <h1 ref={h1} tabIndex={-1}>Your next chapter.<br />Now in the app.</h1>
            <p>Your app access is ready. Install Sowaka Connect, then sign in with your work email.</p>
          </div>
          {workEmail && (
            <div className="g3-install__email">
              <span className="g3-install__label">Your work email</span>
              <div className="g3-install__box">
                <span>{workEmail}</span>
                <button type="button" className="g3-install__copy" aria-label={copied ? 'Copied' : 'Copy work email'} aria-live="polite" onClick={() => copy(workEmail)}>{copied ? <FigCheck size={20} /> : <G3Copy />}</button>
              </div>
              <span className="g3-install__help">Use this in the app, not your personal email.</span>
            </div>
          )}
          <div className="g3-install__cta">
            <a className="fig-btn" href={APP_LINK}><G3Download20 />Install the app</a>
            <p>After installing, open the app to sign in.</p>
          </div>
        </section>
        <div className="g3-spacer" />
      </main>
      <G3WebBottom />
    </FigPage>
  );
}
