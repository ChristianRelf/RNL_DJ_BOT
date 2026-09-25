import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { DeckId, DeckState } from '../protocol';

interface Props {
  socket: Socket | null;
  decks: Record<DeckId, DeckState>;
}

type Pending = { resolve: (pcm: Uint8Array | null) => void; timer: number };

/** Local headphone monitor. Cue PCM comes from the host; master PCM is a read-only mixer tap. */
export function BoothCue({ socket, decks }: Props) {
  const [selected, setSelected] = useState<DeckId | null>(null);
  const [blend, setBlend] = useState(0);
  const [volume, setVolume] = useState(0.65);
  const [status, setStatus] = useState('off');
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [sink, setSink] = useState('default');
  const context = useRef<AudioContext | null>(null);
  const cueGain = useRef<GainNode | null>(null);
  const masterGain = useRef<GainNode | null>(null);
  const nodes = useRef(new Set<AudioBufferSourceNode>());
  const pending = useRef(new Map<string, Pending>());
  const decksRef = useRef(decks);
  decksRef.current = decks;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const nextFrame = useRef(0);
  const cueTime = useRef(0);
  const masterTime = useRef(0);
  const pumping = useRef(false);
  const selectedMediaId = selected ? decks[selected].mediaId : null;

  const stopNodes = () => {
    for (const node of nodes.current) { try { node.stop(); } catch { /* already stopped */ } }
    nodes.current.clear();
  };

  const ensureContext = () => {
    if (!context.current) {
      const audio = new AudioContext({ sampleRate: 48_000 });
      const cue = audio.createGain();
      const master = audio.createGain();
      cue.connect(audio.destination);
      master.connect(audio.destination);
      context.current = audio;
      cueGain.current = cue;
      masterGain.current = master;
    }
    void context.current.resume();
    if ('setSinkId' in context.current && navigator.mediaDevices?.enumerateDevices) {
      void navigator.mediaDevices.enumerateDevices()
        .then((devices) => setOutputs(devices.filter((device) => device.kind === 'audiooutput')))
        .catch(() => undefined);
    }
  };

  useEffect(() => {
    if (cueGain.current) cueGain.current.gain.value = volume * (1 - blend);
    if (masterGain.current) masterGain.current.gain.value = volume * blend;
  }, [blend, volume, selected]);

  const audioBuffer = (pcm: Uint8Array, audio: AudioContext): AudioBuffer => {
    const frames = Math.floor(pcm.byteLength / 4);
    const buffer = audio.createBuffer(2, frames, 48_000);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < frames; i++) {
      left[i] = view.getInt16(i * 4, true) / 32768;
      right[i] = view.getInt16(i * 4 + 2, true) / 32768;
    }
    return buffer;
  };

  useEffect(() => {
    if (!socket) return;
    const onChunk = (message: { requestId: string }, pcm: Uint8Array) => {
      const request = pending.current.get(message.requestId);
      if (!request) return;
      window.clearTimeout(request.timer);
      pending.current.delete(message.requestId);
      request.resolve(pcm?.byteLength ? new Uint8Array(pcm) : null);
    };
    const onError = (message: { requestId: string; error: string }) => {
      const request = pending.current.get(message.requestId);
      if (!request) return;
      window.clearTimeout(request.timer);
      pending.current.delete(message.requestId);
      request.resolve(null);
      setStatus(message.error);
    };
    const onMaster = (pcm: Uint8Array) => {
      const audio = context.current;
      if (!audio || !selectedRef.current || !masterGain.current || !pcm?.byteLength) return;
      const buffer = audioBuffer(new Uint8Array(pcm), audio);
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(masterGain.current);
      const at = Math.max(audio.currentTime + 0.12, Math.min(masterTime.current, audio.currentTime + 0.5));
      source.start(at);
      masterTime.current = at + buffer.duration;
      nodes.current.add(source);
      source.onended = () => nodes.current.delete(source);
    };
    socket.on('cue:chunk', onChunk);
    socket.on('cue:error', onError);
    socket.on('cue:master', onMaster);
    const onConnect = () => {
      if (selectedRef.current) socket.emit('cue:monitor', { enabled: true });
    };
    const onDisconnect = () => setStatus('reconnecting');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('cue:chunk', onChunk);
      socket.off('cue:error', onError);
      socket.off('cue:master', onMaster);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.emit('cue:monitor', { enabled: false });
      for (const request of pending.current.values()) {
        window.clearTimeout(request.timer);
        request.resolve(null);
      }
      pending.current.clear();
    };
  }, [socket]);

  useEffect(() => {
    stopNodes();
    const audio = context.current;
    if (!socket || !selected || !audio) {
      socket?.emit('cue:monitor', { enabled: false });
      setStatus('off');
      return;
    }
    const deck = decksRef.current[selected];
    nextFrame.current = Math.max(0, Math.round(deck.positionMs * 48));
    cueTime.current = audio.currentTime + 0.2;
    masterTime.current = audio.currentTime + 0.12;
    setStatus('buffering');
    pumping.current = false;
    socket.emit('cue:monitor', { enabled: true });

    const requestPcm = (fromFrame: number): Promise<Uint8Array | null> => new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        pending.current.delete(requestId);
        resolve(null);
      }, 4000);
      pending.current.set(requestId, { resolve, timer });
      socket.emit('cue:request', { requestId, deck: selected, fromFrame, frames: 12_000 });
    });

    let cancelled = false;
    const pump = async () => {
      if (pumping.current || cancelled) return;
      pumping.current = true;
      try {
        for (let count = 0; count < 4 && cueTime.current < audio.currentTime + 0.8; count++) {
          const current = decksRef.current[selected];
          if (!current.mediaId || nextFrame.current >= Math.round(current.durationMs * 48)) {
            setSelected(null);
            return;
          }
          const pcm = await requestPcm(nextFrame.current);
          if (cancelled) return;
          if (!pcm) { setStatus('waiting for cue audio'); return; }
          const buffer = audioBuffer(pcm, audio);
          const source = audio.createBufferSource();
          const rate = current.rate;
          source.buffer = buffer;
          source.playbackRate.value = rate;
          source.connect(cueGain.current!);
          const at = Math.max(audio.currentTime + 0.08, cueTime.current);
          source.start(at);
          cueTime.current = at + buffer.duration / rate;
          nextFrame.current += buffer.length;
          nodes.current.add(source);
          source.onended = () => nodes.current.delete(source);
          setStatus('listening');
        }
      } finally { pumping.current = false; }
    };
    void pump();
    const timer = window.setInterval(() => void pump(), 90);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const request of pending.current.values()) {
        window.clearTimeout(request.timer);
        request.resolve(null);
      }
      pending.current.clear();
      socket.emit('cue:monitor', { enabled: false });
      stopNodes();
    };
  }, [selected, selectedMediaId, socket]);

  useEffect(() => () => { stopNodes(); void context.current?.close(); }, []);

  return <div className="booth-cue">
    <div className="tool-label">Headphone cue · local browser only</div>
    <div className="transport-row">
      {(['A', 'B'] as const).map((id) => <button key={id} type="button" className={`btn tiny ${selected === id ? 'is-loop' : ''}`} disabled={!decks[id].mediaId || !socket} aria-pressed={selected === id} onClick={() => {
        if (selected === id) setSelected(null);
        else { ensureContext(); setSelected(id); }
      }}>CUE {id}</button>)}
      <span className="mono cue-status">{status}</span>
    </div>
    <label className="cue-slider">CUE <input type="range" min="0" max="1" step="0.01" value={blend} onChange={(event) => setBlend(Number(event.target.value))} /> MASTER</label>
    <label className="cue-slider">VOLUME <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
    {outputs.length ? <label className="cue-slider">OUTPUT <select value={sink} onChange={(event) => {
      const id = event.target.value;
      setSink(id);
      const audio = context.current as (AudioContext & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
      void audio?.setSinkId?.(id).catch(() => setStatus('Output device unavailable'));
    }}><option value="default">System default</option>{outputs.filter((device) => device.deviceId !== 'default').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Output ${index + 1}`}</option>)}</select></label> : null}
  </div>;
}
