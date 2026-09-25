import { CheckCircle2, CircleAlert, Cloud, Radio, Wifi, WifiOff } from 'lucide-react';
import type { ControlState, HostState, VoiceState } from '../protocol';
import type { ConnectionStatus } from '../socket';
import { formatBytes } from '../lib/format';

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className={ok ? 'is-ready' : 'is-attention'}>
      {ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
      <span><strong>{label}</strong><small>{detail}</small></span>
    </li>
  );
}

export function SystemHealth({
  connection,
  voice,
  host,
  control,
  cacheStatus,
  cachedTracks,
  cacheUsedBytes,
  cacheBudgetBytes,
  persistence,
}: {
  connection: ConnectionStatus;
  voice: VoiceState;
  host: HostState;
  control: ControlState;
  cacheStatus: string;
  cachedTracks: number;
  cacheUsedBytes: number;
  cacheBudgetBytes: number;
  persistence: string;
}) {
  const online = connection === 'online';
  const onAir = voice.status === 'ready';
  const cacheReady = cacheStatus === 'ready' || cachedTracks > 0;

  return (
    <section className="panel system-health">
      <div className="panel-head">
        <h2 className="panel-title">{online ? <Wifi size={13} /> : <WifiOff size={13} />} System health</h2>
        <span className={`system-health-badge ${online ? 'is-ready' : ''}`}>{online ? 'CONNECTED' : connection.toUpperCase()}</span>
      </div>
      <ul>
        <Check ok={online} label="Control link" detail={online ? 'Realtime state is synced' : 'Waiting for the rig'} />
        <Check ok={onAir} label="Discord output" detail={onAir ? voice.channelName ?? 'Voice connected' : voice.status} />
        <Check ok={host.hosted} label="Playback host" detail={host.hosted ? `${host.userName ?? 'Operator'} · ${host.trackCount} tracks` : 'No browser is hosting audio'} />
        <Check ok={cacheReady} label="Local cache" detail={cacheReady
          ? `${cachedTracks} tracks · ${formatBytes(cacheUsedBytes)} / ${formatBytes(cacheBudgetBytes)}`
          : 'No cached tracks on this device'} />
      </ul>
      <div className="system-health-foot">
        <span><Radio size={12} /> {control.holderName ? `${control.holderName} has control` : 'Control is free'}</span>
        <span><Cloud size={12} /> {cacheStatus} · {persistence}</span>
      </div>
    </section>
  );
}
