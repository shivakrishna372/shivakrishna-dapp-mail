import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, Smartphone } from 'lucide-react';
import { Modal, useToast } from './ui.jsx';
import { installState, promptInstall, subscribeInstall } from '../lib/install.js';

export function useInstall() {
  const [state, setState] = useState(installState);
  useEffect(() => subscribeInstall(() => setState(installState())), []);
  return state;
}

function IOSSteps({ onClose }) {
  return (
    <Modal title="Install DAPP Mail on iPhone" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Got it</button>}>
      <ol className="ios-steps">
        <li><span className="ios-ico"><Smartphone size={18} /></span><span>Open <b>dapp-mail.netlify.app</b> in <b>Safari</b>.</span></li>
        <li><span className="ios-ico"><Share size={18} /></span><span>Tap the <b>Share</b> button (square with an arrow).</span></li>
        <li><span className="ios-ico"><SquarePlus size={18} /></span><span>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</span></li>
        <li><span className="ios-ico"><Download size={18} /></span><span>Open DAPP Mail from the new icon and turn on notifications.</span></li>
      </ol>
    </Modal>
  );
}

// Button used in the top bar and on the sign-in page. Renders nothing when already installed
// or when this browser can't install apps.
export function InstallButton({ variant = 'pill' }) {
  const state = useInstall();
  const toast = useToast();
  const [steps, setSteps] = useState(false);
  if (state === 'installed' || state === 'unavailable') return null;

  const onClick = async () => {
    if (state === 'ios') { setSteps(true); return; }
    const ok = await promptInstall();
    if (ok) toast('DAPP Mail installed — find it on your home screen or desktop');
  };

  return (
    <>
      <button className={variant === 'link' ? 'text-btn install-link' : 'btn outline sm install-btn'} onClick={onClick}>
        <Download size={16} /> <span>Install app</span>
      </button>
      {steps && <IOSSteps onClose={() => setSteps(false)} />}
    </>
  );
}
