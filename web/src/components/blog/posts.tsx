import type { ReactNode } from 'react';

/**
 * The written pieces behind /blog.
 *
 * Content only - Blog.tsx owns the index, the reader and the routing. They are
 * split because the copy is a few thousand words a piece and the layout is a
 * hundred lines; keeping them in one file would bury one in the other.
 *
 * Everything technical here is read off the implementation rather than
 * remembered: the frame size, the sample rate, the crossover points, the kill
 * threshold and the fader curve all come from server/src/protocol.ts and
 * server/src/audio/. If any of those change, these posts are wrong and need
 * changing with them - they are the kind of detail a reader will check.
 *
 * House style, so a later post does not read like a different product:
 * plain sentences, no exclamation marks, no invented numbers, no adoption
 * claims, and no advice the console cannot actually carry out.
 */

export const TAGS = [
  { id: 'start', name: 'Getting started' },
  { id: 'technique', name: 'Technique' },
  { id: 'under-the-hood', name: 'Under the hood' },
  { id: 'running-a-night', name: 'Running a night' },
] as const;

export type TagId = (typeof TAGS)[number]['id'];

export interface Post {
  slug: string;
  title: string;
  /** One or two sentences. Used on the card, the reader and the meta tags. */
  summary: string;
  /** ISO, so it sorts as a string and formats without a date parser. */
  date: string;
  author: string;
  tag: TagId;
  /** Minutes at ~220 words. Written down rather than counted off the JSX. */
  minutes: number;
  body: ReactNode;
}

/**
 * Newest first. The index and the next/previous links both read this order, so
 * a post is inserted at the top rather than sorted at runtime.
 */
export const POSTS: Post[] = [
  /* ------------------------------------------------------------------ */
  {
    slug: 'what-happens-to-your-audio',
    title: 'What actually happens to your audio',
    summary:
      'From a file on your laptop to a voice channel, in twenty-millisecond steps. A walk through the whole signal path, including the parts that constrain what the console can do.',
    date: '2026-08-14',
    author: 'RO. Nation LIVE',
    tag: 'under-the-hood',
    minutes: 8,
    body: (
      <>
        <p>
          Most of the time you should not have to think about any of this. You load a track, you
          push a fader, and people hear it. But when something goes wrong - a dropout, a track that
          sounds thinner than it did in your player, a mix that clips only for the listeners - the
          fix is almost always somewhere in the chain between your file and their headphones. So
          here is the whole chain, in order.
        </p>

        <h2>The unit of everything is 20 milliseconds</h2>
        <p>
          Discord's voice protocol wants a packet of audio every 20 milliseconds. That single number
          sets the shape of everything upstream of it. At 48 kHz, 20 milliseconds is exactly 960
          samples per channel, and the mix is stereo, so one frame is 1,920 samples - 3,840 bytes
          as 16-bit integers.
        </p>
        <p>
          The mixer renders one of those frames at a time. Every knob you touch, every EQ band,
          every effect, the crossfader, the limiter - all of it has to happen inside that window,
          repeatedly, forever. If a frame is late, it is not slightly late. It is a gap.
        </p>
        <p>
          That is why the mixer measures how long its frames take rather than assuming. It keeps a
          rolling ten seconds of render times and reports the median and the 95th percentile. The
          headroom in the 20 ms budget is the number that decides what the mix graph can afford, so
          anything expensive has to justify itself against a measurement rather than an opinion.
        </p>

        <h2>Where the audio starts</h2>
        <p>
          Your music does not live on our server. When you point deck at a folder, the browser reads
          those files locally, decodes them locally, and streams short chunks of already-decoded
          audio up to the mixer as it plays. The server never receives your source files and does
          not keep the decoded audio on disk.
        </p>
        <p>
          There are real consequences to that, and they are worth knowing rather than discovering:
        </p>
        <ul>
          <li>
            <strong>Your connection is in the signal path.</strong> The browser hosting playback is
            feeding the mix. A bad upload link on the host's side is a bad night for everyone.
          </li>
          <li>
            <strong>Closing the tab stops the music.</strong> The host browser is not a remote
            control. It is a source.
          </li>
          <li>
            <strong>The library is per-browser.</strong> Scan metadata lives in that browser's
            storage. A different machine is a different library until you point it at the folder.
          </li>
        </ul>
        <p>
          Cloud library tracks work differently - those live in object storage and are delivered
          through a CDN endpoint - but the mixing that happens after they arrive is identical.
        </p>

        <h2>Two decks into one bus</h2>
        <p>
          Each deck produces a stream of samples with its own playback position, its own pitch bend
          and its own loop state. Position is tracked in samples rather than milliseconds, which is
          why a loop set at a beat stays exactly on that beat over hundreds of repeats instead of
          drifting a fraction of a millisecond each pass.
        </p>
        <p>Each deck's output then passes through, in order:</p>
        <ul>
          <li>
            <strong>The three-band isolator.</strong> A low band below 250 Hz, a high band above
            2,500 Hz, and the midrange between them. Turn a band far enough down and it does not
            just get quiet - it mutes outright, at −25.5 dB, the way a hardware kill switch does.
          </li>
          <li>
            <strong>The channel fader,</strong> smoothed rather than applied instantly, so a fast
            move does not produce a click.
          </li>
          <li>
            <strong>The crossfader,</strong> whose curve you control.
          </li>
        </ul>
        <p>
          The eight sample pads and the effects bus join the same mix. Effects keep running for a
          couple of hundred frames after the last note that fed them, so a reverb tail or an echo
          rings out properly instead of being cut off the moment the source stops.
        </p>

        <h2>Why the mixing happens on the server</h2>
        <p>
          A reasonable question: the browser already has the audio, so why not mix there and send
          the result? Because the mix has to be one thing, and there is only one voice connection.
        </p>
        <p>
          Everything that makes the console a console rather than a queue - the fact that a second
          operator can watch your faders move, that control can be handed over mid-set without the
          audio stopping, that the state survives your browser being reloaded - depends on there
          being a single authoritative mixer that is not inside anybody's tab. The browser is a
          source and a control surface. The mix itself has to live where the voice connection is.
        </p>
        <p>
          It also means the expensive, unglamorous parts are somewhere they can be measured and
          budgeted rather than somewhere they compete with whatever else the host's laptop is
          doing.
        </p>

        <h2>Latency, and what you are actually hearing</h2>
        <p>
          There is a delay between you moving a control and a listener hearing the result. It is
          made of several parts, and they are not all ours: the browser sending its chunk, the mixer
          rendering the next frame, the encoder, Discord's distribution, and finally the listener's
          own client buffering before playback.
        </p>
        <p>
          Two practical consequences follow, and both catch people out.
        </p>
        <ul>
          <li>
            <strong>Do not monitor by listening in the voice channel.</strong> If you sit in the
            channel with your own set playing, you are hearing something later than you are doing,
            and trying to beatmatch against it will send you slowly insane. Monitor locally.
          </li>
          <li>
            <strong>Chat reactions lag reality.</strong> When someone says the transition was
            rough, they mean a transition you finished several seconds ago. This matters more than
            it sounds when you are trying to respond to a room.
          </li>
        </ul>

        <h2>The meters fall slower than the music</h2>
        <p>
          The peak meters decay at roughly 20 dB per second rather than dropping instantly to the
          current sample value. That is a deliberate choice and not an inaccuracy: a meter that
          tracked the true instantaneous peak would be an unreadable flicker, because music is full
          of transients that are over before your eye registers them.
        </p>
        <p>
          What you get instead is a needle that jumps immediately and falls back gently, so you can
          see the shape of the level rather than a strobe. When you are gain staging, the number to
          watch is where the meter <em>peaks</em>, not where it sits.
        </p>

        <h2>The crossfader curve is one number</h2>
        <p>
          The crossfader has a shape control that runs from 0 to 1, and internally that maps to a
          sharpness between 1 and 15. At the bottom of the range you get a long, gentle blend -
          both decks audible across most of the travel, which is what you want for a slow transition
          between two tracks that are already beatmatched. At the top you get something close to a
          hard cut: the far deck stays silent until you are almost all the way over, then arrives
          suddenly.
        </p>
        <p>
          Neither setting is correct. They are different instruments. Long blends are for mixing;
          sharp cuts are for scratching and for rhythmic chopping between two tracks. If you have
          never moved it off the default, move it to the top for one set and see what it makes you
          play differently.
        </p>

        <h2>The limiter, and why your mix is quieter than you set it</h2>
        <p>
          After everything is summed, a limiter holds the peak just under full scale. It is
          deliberately not at full scale, because the Opus encoder immediately downstream needs
          headroom. An encoder handed samples that are already at the ceiling will produce output
          that overshoots it, and the result is distortion that exists only after encoding - which
          means you will not hear it locally, and your listeners will.
        </p>
        <p>
          This is the single most common reason a mix sounds fine in the booth and harsh in the
          voice channel. The limiter will save you from the worst of it, but a limiter working hard
          the whole night is not a mix, it is a compressor you did not ask for. Give it less to do.
        </p>

        <h2>Then it becomes packets</h2>
        <p>
          The finished frame is encoded as Opus at 48 kHz stereo and handed to the voice connection,
          which sends it to Discord, which distributes it to everyone in the channel. From here on
          it is out of our hands and out of yours: what each listener hears depends on their
          connection, their client and their own output settings.
        </p>
        <p>
          Worth being honest about: this is a lossy codec on a real-time budget over the public
          internet. It is genuinely good, and it is not a mastering chain. Play music you would be
          happy to hear on a decent radio stream, and do not spend your evening chasing a
          difference nobody in the channel can hear.
        </p>

        <h2>What the frame budget rules out</h2>
        <p>
          It is worth being straight about the consequences of a hard 20 ms deadline, because they
          explain some absences.
        </p>
        <p>
          Anything that needs to look ahead in the audio cannot run in the live path. A true
          look-ahead limiter, for example, needs to see the future to decide what to do now, and the
          future has not been rendered yet. Anything with an unpredictable worst case is also out:
          an effect that is cheap for ninety-nine frames and expensive for the hundredth does not
          average out, it drops the hundredth frame, and a dropped frame is audible in a way that
          a slightly less sophisticated effect is not.
        </p>
        <p>
          This is why the effects here are the classics - echo, reverb and flanger - implemented as
          fixed-cost delay lines and filters. They are not the most advanced processors available.
          They are the ones with a cost you can guarantee, and guaranteed is worth more than
          impressive when the alternative is a gap in the music.
        </p>

        <h2>So when something sounds wrong</h2>
        <p>Work down the chain in order, because the order tells you where to look.</p>
        <ul>
          <li>
            <strong>Only some listeners hear it</strong> - it is Discord or their client, not your
            mix. Nothing you do at the console will fix it.
          </li>
          <li>
            <strong>Everyone hears gaps or stutters</strong> - look at the host browser first: its
            connection, its CPU, how many other tabs are competing with it.
          </li>
          <li>
            <strong>Everyone hears harshness on loud passages</strong> - that is headroom. Your
            gains are too hot going into the limiter.
          </li>
          <li>
            <strong>One track sounds wrong and the others do not</strong> - it is the file, or the
            gain you set on that deck, not the pipeline.
          </li>
        </ul>
        <p>
          Almost everything that goes wrong is in the first or last link: the browser feeding the
          mix, or the listener receiving it. The middle is the part that is measured.
        </p>
      </>
    ),
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'gain-staging-for-a-voice-channel',
    title: 'Gain staging for a voice channel',
    summary:
      'The least glamorous skill in DJing, and the one that most reliably separates a set that sounds professional from one that does not. Especially over a codec.',
    date: '2026-08-07',
    author: 'RO. Nation LIVE',
    tag: 'technique',
    minutes: 6,
    body: (
      <>
        <p>
          Nobody has ever left a set saying the gain staging was excellent. They leave saying it
          sounded good, or they leave saying it sounded harsh and they are not sure why. Gain
          staging is the difference, and it takes about ten minutes to learn properly.
        </p>

        <h2>The problem, stated plainly</h2>
        <p>
          Your tracks are not all the same loudness. A record mastered in 1994 and a record mastered
          last year can differ by ten decibels or more, and ten decibels is not a subtlety - it is
          the difference between a transition nobody notices and one that makes people reach for
          their volume. Streaming services hide this from you with automatic normalisation. A mixing
          console does not, because a console assumes you want control.
        </p>
        <p>
          So the job is to make every track arrive at the mix bus at roughly the same level, using
          the deck gain, so that your faders and your crossfader are doing what you think they are
          doing.
        </p>

        <h2>Why it matters more here than in a club</h2>
        <p>
          In a room, a hot signal mostly means a loud room. Over a voice channel there are two extra
          consequences.
        </p>
        <p>
          <strong>The codec has to be given headroom.</strong> The mix is limited just below full
          scale on purpose, because an Opus encoder fed samples sitting on the ceiling produces
          output that overshoots it. That distortion is created during encoding, which means it does
          not exist in your monitoring and does exist in everyone else's ears. You cannot hear the
          problem you are causing.
        </p>
        <p>
          <strong>Listeners cannot compensate.</strong> In a room, someone standing too near a
          speaker moves. In a voice channel, everyone gets the same stream, and their only control
          is a volume slider that does nothing about distortion already baked in.
        </p>

        <h2>How to actually do it</h2>
        <p>
          Set it once per track when you load it, not in the middle of a transition. The routine
          takes a few seconds.
        </p>
        <ul>
          <li>
            <strong>Cue the loudest part of the track,</strong> not the intro. Intros lie. Find the
            drop, the chorus, wherever the track is at its fullest.
          </li>
          <li>
            <strong>Watch the meter, not the waveform.</strong> The waveform shows you the whole
            file at once; the meter shows you what is happening now, which is what the limiter sees.
          </li>
          <li>
            <strong>Aim for the meters to sit consistently high but not pinned.</strong> Peaks
            touching the top occasionally are fine. Peaks living at the top means you are feeding
            the limiter a level it has to fight all night.
          </li>
          <li>
            <strong>Match the outgoing track, not an abstract target.</strong> The only comparison
            that matters is between the two things that are about to be next to each other.
          </li>
        </ul>

        <h2>Peak is not loudness</h2>
        <p>
          Here is the trap that makes gain staging feel unintuitive: the meter shows you peak level,
          and your ears judge average level. Those two things can be very far apart.
        </p>
        <p>
          A heavily compressed modern master is dense - its average sits close to its peak - so it
          sounds loud at a given meter reading. A dynamic recording with real transients has the
          same peak but a much lower average, and sounds noticeably quieter beside it. Match them by
          meter alone and the dynamic track will sound like a drop in volume.
        </p>
        <p>
          So use the meter to stay out of trouble at the top, and use your ears for the actual
          match. The workflow that gets you both: set the gain roughly by meter, then A/B the two
          tracks at their loudest sections and trim by ear. The meter defines the ceiling; your ears
          define the level.
        </p>

        <h2>Three controls, three jobs</h2>
        <p>
          Most level confusion comes from using one control to do another's job. They are not
          interchangeable, even though all three make things louder and quieter.
        </p>
        <ul>
          <li>
            <strong>Gain</strong> sets how loud this track is relative to every other track. Set it
            once, when you load, and then leave it alone.
          </li>
          <li>
            <strong>The channel fader</strong> sets how much of this deck is in the mix right now.
            This is the one you perform with.
          </li>
          <li>
            <strong>The crossfader</strong> decides the balance between the two decks. It is about
            transition shape, not about level.
          </li>
        </ul>
        <p>
          The tell that something has gone wrong is a fader living near the bottom of its travel. A
          fader at ten percent has almost no useful resolution left - every small movement is a
          large jump - and it means the gain above it is set far too high. Pull the gain down and
          bring the fader back up to where it can actually be played.
        </p>

        <h2>The thing everyone gets wrong</h2>
        <p>
          Turning a deck up because it sounds quiet <em>during a transition</em>, when both decks are
          playing. Two tracks playing together are louder than either alone - that is arithmetic,
          not a problem to be fixed. If you push the incoming deck up to match the perceived level
          of the pair, you have set it too loud, and it will be too loud the moment the outgoing
          track leaves.
        </p>
        <p>Set gain in isolation. Judge the blend with the faders.</p>

        <h2>Where the isolator fits</h2>
        <p>
          The three-band isolator is not a gain control, and using it as one is how mixes get
          muddy. What it is genuinely good for during a transition is making room. Two tracks both
          playing full-range bass do not sound twice as big; they sound like a fight. Pulling the
          low band down on the incoming deck until the swap is complete is the oldest trick in the
          format and it still works.
        </p>
        <p>
          Bear in mind the bands here are wide and deliberately blunt: everything below 250 Hz,
          everything above 2,500 Hz, and the middle. This is an isolator, not a surgical EQ. Turn a
          band far enough down and it mutes outright at −25.5 dB rather than merely getting quiet,
          which is exactly what you want for a kill and exactly what you do not want if you were
          trying to make a small correction.
        </p>

        <h2>Libraries that have been normalised already</h2>
        <p>
          If your files came from a service that applied loudness normalisation, or you have run
          something like ReplayGain over your collection, a lot of this work is already done and
          your tracks will land within a decibel or two of each other. That is a genuinely good
          position to start from.
        </p>
        <p>
          It is not a reason to skip the check, for two reasons. Normalisation targets average
          loudness, so two tracks matched by that measure can still have very different peaks - and
          peaks are what the limiter reacts to. And any collection assembled over years will have
          gaps: the rip from a CD, the promo somebody sent you, the live recording. Those are
          exactly the files that will surprise you.
        </p>

        <h2>Do it before the set, not during it</h2>
        <p>
          The single highest-value habit here is setting gains during preparation rather than
          performance. Load each track you expect to play, find its loudest section, set the gain,
          and move on. Ten tracks takes about five minutes.
        </p>
        <p>
          The reason is not that it is faster. It is that gain staging requires calm comparison, and
          the moment you are thirty seconds from needing a transition you have neither. Every
          decision you can move out of the live window is one more piece of attention available for
          the thing you cannot prepare, which is what the room is actually doing.
        </p>

        <h2>A short checklist</h2>
        <ul>
          <li>Gain set at load time, from the loudest section, in isolation.</li>
          <li>Faders live near the top of their travel, not clustered at the bottom.</li>
          <li>Meters consistently high, occasionally near the ceiling, never pinned there.</li>
          <li>Low band used to make room during a swap, then returned.</li>
          <li>If it sounds harsh to a listener but clean to you, it is headroom. Every time.</li>
        </ul>
        <p>
          Do this for a couple of sets and it stops being a checklist and becomes a habit you
          perform without noticing. That is the point at which people start telling you your sets
          sound good, without being able to say why.
        </p>
      </>
    ),
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'beatmatching-by-ear',
    title: 'Beatmatching by ear, and why the numbers lie',
    summary:
      'Detected tempo is a starting point, not an answer. How to hear drift, which direction to correct, and why the skill is still worth having when software will do it for you.',
    date: '2026-07-29',
    author: 'RO. Nation LIVE',
    tag: 'technique',
    minutes: 6,
    body: (
      <>
        <p>
          There is a reasonable argument that beatmatching by ear is a solved problem and you should
          let the analysis do it. The argument is wrong, but not for the romantic reason people
          usually give. It is wrong because detected tempo is frequently, quietly, specifically
          incorrect in ways that will embarrass you in front of an audience.
        </p>

        <h2>How tempo detection fails</h2>
        <p>
          Automatic tempo detection works by finding periodic energy and deciding which period is
          the beat. It is very good at this for music that has an obvious, consistent kick pattern.
          It is much worse in four situations you will absolutely encounter:
        </p>
        <ul>
          <li>
            <strong>Half-time and double-time confusion.</strong> A track at 140 gets read as 70, or
            a track at 87 gets read as 174. The number is not wrong so much as it is answering a
            different question.
          </li>
          <li>
            <strong>Live drummers.</strong> Anything recorded by humans without a click drifts.
            There is no single correct tempo to detect, because there is not one.
          </li>
          <li>
            <strong>Sparse or syncopated intros.</strong> If the first thirty seconds have no kick,
            the detector is guessing from whatever else is periodic.
          </li>
          <li>
            <strong>Tracks with a tempo change.</strong> One number cannot describe two tempos.
          </li>
        </ul>
        <p>
          Worse, a wrong tempo is not obviously wrong. It is a plausible number sitting next to a
          waveform, and it will look right up until the moment two bars into your transition when it
          audibly is not.
        </p>

        <h2>What you are actually listening for</h2>
        <p>
          When two tracks are close but not matched, you do not hear "two tempos". You hear one of
          two things, and telling them apart is most of the skill.
        </p>
        <p>
          <strong>A flam</strong> - the two kicks land almost together, producing a thickened,
          slightly smeared thump instead of a single clean hit. This means you are close. The gap is
          small and constant enough to perceive as one event.
        </p>
        <p>
          <strong>Drift</strong> - the kicks start together and separate over four or eight bars,
          or start apart and converge. This means the tempos genuinely differ, and no amount of
          nudging the position will fix it. You need pitch, not alignment.
        </p>
        <p>
          The order matters. Fix the tempo first, then the alignment. Correcting alignment while the
          tempos differ is chasing a moving target, and you will end up nudging every eight bars for
          the whole transition.
        </p>

        <h2>Which way to push</h2>
        <p>
          Everyone struggles with this at first, and there is a trick that makes it immediate. Do
          not think about which track is faster. Listen to the incoming track and ask: is its kick
          arriving <em>early</em> or <em>late</em> relative to the one already playing?
        </p>
        <ul>
          <li>Arriving early and getting earlier - it is running fast. Pitch it down.</li>
          <li>Arriving late and getting later - it is running slow. Pitch it up.</li>
        </ul>
        <p>
          Then use temporary bend - a nudge that speeds up or slows down while you hold it and
          returns afterwards - to close the remaining gap without changing the pitch you just set.
          That is the division of labour: pitch for the tempo, bend for the phase.
        </p>

        <h2>Use the waveform, but not as the answer</h2>
        <p>
          The waveform is genuinely useful for the coarse work. You can see the structure, find the
          drop, see where the intro ends, and get roughly aligned before you unmute anything. Cue
          points let you save those places so you are not hunting for them live.
        </p>
        <p>
          What the waveform is not good for is the last few milliseconds, because a few milliseconds
          is a fraction of a pixel and you can hear it perfectly well. At some point you have to
          stop looking at the screen. A useful discipline: get it visually close, then look away
          from the display entirely and finish it by ear. You will be faster, and you will build the
          reflex that saves you when the analysis is wrong.
        </p>

        <h2>Phrasing is the part people skip</h2>
        <p>
          Two tracks can be perfectly beatmatched and the transition can still sound wrong, and when
          that happens the problem is almost always phrasing.
        </p>
        <p>
          Most dance music is built in phrases of eight bars, grouped into sixteens and
          thirty-twos. Sections change on those boundaries because that is where the ear expects
          change. If you bring a new track in four bars out of phase, its downbeats land on your
          upbeats and its chorus arrives in the middle of the other track's verse. Every individual
          beat lines up, and the music does not.
        </p>
        <p>
          Counting is the fix, and it is unglamorous: count phrases of eight from a point you know
          is a boundary, and start the incoming track at the top of one. After a while you stop
          counting and start hearing it, but you have to count first.
        </p>
        <p>
          This is also the most common thing a beginner is hearing when they say a mix sounds
          "off" but the beats are matched. It is not the tempo. It is the bar.
        </p>

        <h2>Cue points are the memory you will not have</h2>
        <p>
          Under pressure you will not remember that the good bit starts at 1:47, and you will not
          find it by dragging the waveform while a track is playing.
        </p>
        <p>
          Set cue points during preparation, on the boundaries that matter: the first downbeat, the
          point where the drums enter, the start of the outro you intend to mix out of. Then live,
          getting to any of them is one action instead of a hunt.
        </p>
        <p>
          The first downbeat is the one that pays for itself immediately. A surprising number of
          files have a fraction of a second of silence or a partial bar at the start, and a cue
          point placed on the actual first beat means "start the track" is exact every time rather
          than approximately right and in need of a nudge.
        </p>

        <h2>Loops buy you time</h2>
        <p>
          A loop is usually presented as a creative tool, and it is, but its most valuable use for
          anyone still building confidence is defensive. If the outgoing track is about to run out
          and your incoming track is not ready, loop the last eight bars of what is playing. You now
          have as long as you need.
        </p>
        <p>
          Because loop positions are tracked in samples rather than milliseconds, a loop set on a
          beat stays on that beat over hundreds of repeats instead of drifting slightly each pass.
          You can leave one running for a genuinely long time without it degrading, which is exactly
          what you want from a safety net.
        </p>
        <p>
          Used well, nobody notices. A loop over an instrumental section sounds like the track. Used
          badly - eight bars of an obvious vocal hook, sixteen times - everybody notices. Loop
          something that does not announce itself.
        </p>

        <h2>Practising the thing that is actually hard</h2>
        <p>
          Most people practise beatmatching by beatmatching, which turns out to be an inefficient
          way to learn it. Two drills work better.
        </p>
        <p>
          <strong>Deliberately mismatch, then recover.</strong> Set the incoming track a couple of
          percent off on purpose. Now fix it, by ear, with the display ignored. Do this ten times.
          You are training the direction reflex, which is the part that fails under pressure.
        </p>
        <p>
          <strong>Match tracks with no kick in the intro.</strong> Ambient openings, live
          recordings, anything sparse. This forces you to find the pulse in something other than the
          most obvious element, which is the situation where the detector is least reliable and you
          are most needed.
        </p>

        <h2>Why bother</h2>
        <p>
          Not because doing it manually is more authentic. Because a set is a live performance and
          live performances go wrong. The track that was analysed incorrectly, the request you had
          not heard before, the moment you need to get out of a mix early because something has
          changed in the room - all of those need you to be able to hear what is happening and fix
          it in a few seconds.
        </p>
        <p>
          The analysis is a tool that is right most of the time. Your ears are the thing that
          notices when it is not.
        </p>
      </>
    ),
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'your-first-hour-behind-the-decks',
    title: 'Your first hour behind the decks',
    summary:
      'A realistic first session: what to prepare, what to ignore, and the smallest set of skills that gets you through an hour without anything falling over.',
    date: '2026-07-18',
    author: 'RO. Nation LIVE',
    tag: 'start',
    minutes: 6,
    body: (
      <>
        <p>
          The console has two decks, a three-band isolator per channel, eight sample pads, three
          effects, loops, cue points, a configurable crossfader and a request queue. You need
          almost none of that in your first hour, and trying to use all of it is the most reliable
          way to have a bad time.
        </p>
        <p>Here is what a first session actually looks like if it goes well.</p>

        <h2>Before you start: prepare eight tracks</h2>
        <p>
          Not a hundred. Eight. Enough for an hour if you play most of each one, with a couple
          spare. Choosing from a folder of two thousand files while people are listening is a
          specific kind of paralysis and there is no reason to volunteer for it.
        </p>
        <p>
          Pick them so that consecutive tracks are close in tempo - within a few percent - and put
          them in an order you have actually listened to. Yes, that is a playlist. A playlist you can
          deviate from is not a failure of nerve, it is a safety net.
        </p>
        <p>
          Load them, let the library scan finish, and check the detected tempos look sane. If a
          track you know is at 128 reads as 64, note it now rather than discovering it live.
        </p>

        <h2>The four things you need</h2>
        <p>
          Everything else can wait until session three. These four are non-negotiable because they
          are the ones that keep audio playing.
        </p>
        <ul>
          <li>
            <strong>Load a track to a deck.</strong> Two decks: A and B. Whatever is not playing is
            where the next track goes.
          </li>
          <li>
            <strong>Play and pause.</strong> <kbd>Q</kbd> for deck A, <kbd>P</kbd> for deck B. Learn
            these on the keyboard rather than the mouse - it is one less thing to aim at.
          </li>
          <li>
            <strong>The channel faders,</strong> for level.
          </li>
          <li>
            <strong>The crossfader,</strong> for moving between the two.
          </li>
        </ul>
        <p>
          That is a whole hour of radio, right there. Not an exciting hour, but a competent one, and
          competent is a much better first goal than exciting.
        </p>

        <h2>Set your space up first</h2>
        <p>
          Ten minutes of setup removes most of the things that go wrong in a first session, and none
          of it is about music.
        </p>
        <ul>
          <li>
            <strong>Headphones, wired if you have them.</strong> Bluetooth adds delay, and delay is
            the enemy of every timing judgement you are about to make.
          </li>
          <li>
            <strong>Monitor locally, not in the voice channel.</strong> What comes back through
            Discord is later than what you are doing. Beatmatching against it is impossible and
            frustrating in that order.
          </li>
          <li>
            <strong>Plug the laptop in and stop it sleeping.</strong> The tab is the source. A
            machine that sleeps is a set that ends.
          </li>
          <li>
            <strong>Close the other tabs.</strong> Whatever is decoding video in the background is
            competing with the thing feeding the mix.
          </li>
          <li>
            <strong>Put a drink somewhere you cannot knock it onto the keyboard.</strong> This is
            advice from experience.
          </li>
        </ul>

        <h2>The simplest transition that works</h2>
        <p>
          Do not attempt a beatmatched blend in your first hour. Do this instead, and do it well:
        </p>
        <ul>
          <li>Track A is playing, and is heading towards its outro.</li>
          <li>Load track B and set its gain from its loudest section.</li>
          <li>Start B during A's outro, where A has thinned out.</li>
          <li>Move the crossfader across over a few seconds.</li>
        </ul>
        <p>
          This works because outros are designed to be left. The producer has already removed most
          of the elements for you. You are not fighting two full arrangements, you are walking out
          of one and into another, and nobody in the channel is going to complain.
        </p>
        <p>
          Once that is comfortable, the next thing to learn is holding the incoming track's low band
          down until the swap is complete. That single move is most of what makes a transition sound
          intentional.
        </p>

        <h2>Set the crossfader curve first</h2>
        <p>
          One setting, done before you start. The crossfader's shape control runs from a long gentle
          blend to something close to a hard cut. For your first session you want the gentle end -
          it makes the fader forgiving, and it means a slightly clumsy move still sounds like a
          fade rather than a jump.
        </p>
        <p>Move it towards the sharp end when you start wanting to cut rhythmically. Not before.</p>

        <h2>Say something, once</h2>
        <p>
          You do not have to talk over the music, and mostly you should not. But arriving in silence
          and leaving in silence makes an hour of music feel like a playlist somebody left running.
        </p>
        <p>
          A message in the channel at the start - what you are playing, roughly how long you are on
          - and one at the end is enough. If somebody comments on a track, answer them. The
          difference between a stream and an event is that at an event somebody is present, and
          typing two sentences is a very low bar for being present.
        </p>
        <p>
          If requests are open, say so, and say what you will do with them. Silence on that point
          produces a queue nobody understands the status of.
        </p>

        <h2>What will go wrong</h2>
        <p>Predictably, and none of it is a disaster.</p>
        <ul>
          <li>
            <strong>You will start a track at the wrong moment.</strong> Pause it, move it back,
            start it again. Two seconds of silence on the incoming channel is nothing. Panicking and
            leaving it playing out of time for a minute is something.
          </li>
          <li>
            <strong>A track will be much louder than the last one.</strong> That is gain staging,
            and it is why you set gain at load time.
          </li>
          <li>
            <strong>You will run out of track sooner than you expected.</strong> Everyone does. Keep
            one eye on the waveform of what is playing, not just on what you are cueing.
          </li>
          <li>
            <strong>Someone will request something you do not have.</strong> Say so. It is fine.
          </li>
        </ul>

        <h2>Remember the tab is the source</h2>
        <p>
          The browser hosting playback is not a remote control - it is feeding the mix. Closing it,
          letting the machine sleep, or dropping off the network stops the music. Before you start:
          plug the laptop in, turn off sleep, and do not use that tab for anything else.
        </p>

        <h2>What to add next</h2>
        <p>
          Once the four basics are automatic - and that takes two or three sessions, not months -
          add one thing at a time, in roughly this order. Each one assumes the last.
        </p>
        <ul>
          <li>
            <strong>The low band on the incoming deck.</strong> Kill it before the swap, bring it
            back after. This single move is most of what makes a transition sound deliberate.
          </li>
          <li>
            <strong>Cue points.</strong> Mark the first downbeat and the start of the outro on every
            track you prepare. Stop hunting.
          </li>
          <li>
            <strong>Beatmatching.</strong> Now that you are not also fighting the interface, this is
            a much smaller problem than it looks from the outside.
          </li>
          <li>
            <strong>Loops,</strong> first as a safety net for when the incoming track is not ready,
            later as something you do on purpose.
          </li>
          <li>
            <strong>The pads and the effects rack.</strong> Genuinely last. They are the easiest
            things to overuse and the hardest to use well.
          </li>
        </ul>
        <p>
          If you are wondering why effects are at the bottom of a list and the low-band kill is at
          the top: the kill improves every transition you will ever do, and a reverb improves about
          one moment a set, if you pick the moment correctly.
        </p>

        <h2>Afterwards</h2>
        <p>
          Write down the two moments that felt wrong while they are still fresh. Not to punish
          yourself - because in a week you will remember that the set was "a bit rough" without
          remembering what specifically to practise, and the specifics are the entire value of the
          session.
        </p>
        <p>
          One hour, eight tracks, four controls, transitions in the outros. That is a real set. The
          effects rack will still be there next week.
        </p>
      </>
    ),
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'running-a-night-with-more-than-one-dj',
    title: 'Running a night with more than one DJ',
    summary:
      'Handovers, back-to-backs and the queue. The organisational problems that decide whether a multi-DJ night feels like an event or like a series of interruptions.',
    date: '2026-07-09',
    author: 'RO. Nation LIVE',
    tag: 'running-a-night',
    minutes: 6,
    body: (
      <>
        <p>
          One person playing records is a straightforward technical problem. Four people playing
          records in sequence is an organisational one, and it is the organisational part that
          decides whether the night feels like an event or like four separate things that happened
          in the same channel.
        </p>

        <h2>One operator at a time, on purpose</h2>
        <p>
          Only one person holds control of the decks at any moment. Everyone else who is signed in
          can see the console - what is loaded, what is playing, where the faders are - but cannot
          move anything. Control is handed over explicitly by request, or released automatically
          after a period of inactivity.
        </p>
        <p>
          This is a deliberate constraint rather than a missing feature. Shared, simultaneous
          control of a live mix is not collaboration; it is two people fighting over a crossfader in
          front of an audience. The queue makes the handover a decision somebody makes rather than a
          race somebody wins.
        </p>

        <h2>The handover is a transition</h2>
        <p>
          The most common failure in a multi-DJ night is treating the handover as an administrative
          event that happens between two sets. It is not. It is a transition, and it is the most
          exposed transition of the night, because two people have to agree on it in real time.
        </p>
        <p>Three things make it work.</p>
        <ul>
          <li>
            <strong>Agree the moment in advance,</strong> not the minute. "At the end of this track"
            is a moment. "Around ten" is not, and produces a set that limps to a halt while everyone
            waits for a clock.
          </li>
          <li>
            <strong>The outgoing DJ ends on something leavable.</strong> Do not hand over in the
            middle of your biggest moment. It is unfair to the incoming DJ, who now has to follow a
            peak with a cold start.
          </li>
          <li>
            <strong>The incoming DJ has their first track chosen and its gain set</strong> before
            they take control. The first thirty seconds of a set are the ones people judge, and
            spending them scrolling a library is a bad trade.
          </li>
        </ul>

        <h2>Order the night deliberately</h2>
        <p>
          The most common mistake in booking a community night is putting the strongest DJ on first
          because they are the strongest. What you get is a peak in the first hour and a room that
          empties for the rest of it.
        </p>
        <p>
          The traditional structure exists because it works: open lower and slower, build through
          the night, and let the last slot bring it down or hold it, depending on what you are
          running. It is not a rule, but if you are going to break it, break it because you decided
          to, not because nobody thought about the order.
        </p>
        <p>
          Tell people the shape as well as the slot. "You are on at nine, and you are the one who
          takes it to the peak" is far more useful than a time, and it is the difference between
          four DJs playing their own sets and four DJs playing one night.
        </p>

        <h2>The first fifteen minutes decide the night</h2>
        <p>
          A voice channel with two people in it is a hard place to start. There is a threshold
          effect: below a handful of listeners nobody wants to be the first to arrive, and above it
          people stay because other people are there.
        </p>
        <p>
          So treat the opening as a job rather than as a warm-up. Start on time - a night that
          begins twenty minutes late has taught everyone to arrive twenty minutes late next week.
          Post in the channel when you go live rather than assuming people are watching. And have
          somebody other than the DJ in the channel talking, because a room with conversation in it
          reads as somewhere to stay and a silent room reads as somewhere nothing is happening.
        </p>

        <h2>Tell people it is happening</h2>
        <p>
          The most common reason a good night has no audience is that it was announced once, in one
          place, several days early.
        </p>
        <p>
          Two posts beat one: something a few days ahead with the line-up and the times, and
          something short when it actually starts. The second one matters more than the first,
          because it arrives while the decision is live. Pin it. Include the times in a form people
          in other timezones can act on.
        </p>
        <p>
          And say what the night <em>is</em>. "DJ night, 8pm" tells nobody whether they want to be
          there. What is being played, and what kind of evening it is, is the part that makes
          somebody show up.
        </p>

        <h2>Requests need a policy, not a vibe</h2>
        <p>
          Listeners who are in the server but do not have a DJ role can submit track requests from
          the rig's request page. The requests arrive in a queue for whoever is on. This is good,
          and it will go wrong in exactly one way if you leave it unmanaged: the first enthusiastic
          person establishes the norm for the night.
        </p>
        <p>Decide, before you start, and say it out loud:</p>
        <ul>
          <li>Are requests open all night, or during particular slots?</li>
          <li>Is the DJ obliged to acknowledge them, or free to ignore them silently?</li>
          <li>Who clears the queue between sets, so the next DJ does not inherit a backlog?</li>
        </ul>
        <p>
          Any answer works. No answer produces a DJ who feels guilty about a growing list and a
          requester who feels ignored.
        </p>

        <h2>Back-to-backs are a different skill</h2>
        <p>
          Two DJs alternating track for track is genuinely different from two DJs doing an hour
          each, and it is worth saying out loud which one you are doing. The failure mode of a
          back-to-back is two people trying to steer, each pulling slightly harder each time
          because they think the other has lost the thread.
        </p>
        <p>
          Agree who has the direction, or agree explicitly that you are trading it every few tracks.
          Then actually listen to what the other person just played, and follow it, rather than
          playing the track you had already decided on.
        </p>

        <h2>When something breaks</h2>
        <p>
          Over a long enough run of nights, someone's connection will die mid-set. Plan for it once,
          in advance, and it becomes a two-minute inconvenience instead of the end of the evening.
        </p>
        <ul>
          <li>
            <strong>Know who takes over.</strong> If control is held by somebody who has vanished,
            it releases after a period of inactivity - but somebody has to be ready to pick it up
            and have something to play.
          </li>
          <li>
            <strong>Have a filler.</strong> One person with a prepared handful of tracks who can
            cover twenty minutes at no notice turns a disaster into a gap.
          </li>
          <li>
            <strong>Say what is happening in the channel.</strong> An unexplained silence empties a
            room faster than any technical fault. "Back in five, connection died" keeps everyone
            where they are.
          </li>
        </ul>

        <h2>Afterwards is part of the night</h2>
        <p>
          The twenty minutes after the last track is when a one-off becomes a series. People are
          still in the channel and still in a good mood, which is the best moment there will ever be
          to ask what they want next time.
        </p>
        <p>
          Thank the people who played, by name, where everyone can see it. Ask who wants a slot next
          time - you will get volunteers then who would never message you cold three days later. And
          if something went wrong, say so plainly and say what you are changing. A community that
          watches you fix things is a community that keeps turning up.
        </p>

        <h2>The unglamorous part</h2>
        <p>
          Someone has to own the night: post the times, chase the person who has not confirmed, be
          in the channel early, and be ready to fill twenty minutes when somebody's internet dies.
          That role is not DJing and it is the reason some communities have a night every week and
          others have one great night and then never again.
        </p>
        <p>
          If it is not obvious who that person is, it is you. Sorry.
        </p>
      </>
    ),
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'the-isolator-is-not-an-eq',
    title: 'The isolator is not an EQ',
    summary:
      'Three wide bands, a hard kill, and a completely different set of uses from the corrective EQ you are picturing. What the low, mid and high controls are actually for.',
    date: '2026-06-27',
    author: 'RO. Nation LIVE',
    tag: 'technique',
    minutes: 5,
    body: (
      <>
        <p>
          Almost everyone arriving from music production treats the three knobs on a DJ channel as a
          small mixing-desk EQ: a tool for correcting a track that has too much of something. Used
          that way, they do very little, and the natural conclusion is that they are a bit useless.
        </p>
        <p>They are not an EQ. They are an isolator, and it is a performance instrument.</p>

        <h2>The bands are enormous</h2>
        <p>
          Here the split is at 250 Hz and 2,500 Hz. The low band is everything below 250. The high
          band is everything above 2,500. The mid is the entire remaining middle - which, not
          coincidentally, is where most of a vocal, most of a snare, and most of the recognisable
          character of a track lives.
        </p>
        <p>
          Those are not surgical ranges. You cannot use them to fix a resonance or tame a harsh
          cymbal, because reaching the cymbal means taking everything above 2.5 kHz with it. If you
          try to make small corrective moves, you will make the track worse in three places to
          improve it in one.
        </p>

        <h2>The bottom of the knob is a switch</h2>
        <p>
          The other half of the design: turn a band far enough down and it does not merely get very
          quiet. At −25.5 dB it mutes outright, exactly the way a hardware kill switch does.
        </p>
        <p>
          This is a musical decision, not an implementation detail. A band that fades to
          near-silence leaves a thin ghost of itself behind, and that ghost is audible and messy when
          two tracks are playing. A band that is off is off, and it makes the swap clean. It also
          means a full kill is a definite position you can find quickly under pressure, rather than a
          value you have to be careful about.
        </p>

        <h2>What they are actually for</h2>
        <p>
          <strong>Making room during a transition.</strong> The central use, and worth more than
          every other technique combined. Two tracks with full bass playing together do not sound
          twice as big; the kicks collide and the low end turns to mush. Kill or heavily cut the low
          band on the incoming deck, bring it in, then swap the low bands over at the moment you
          want the new track to take charge. That swap is the transition. Everything else is
          decoration.
        </p>
        <p>
          <strong>As a rhythmic instrument.</strong> Killing the low band for a bar and bringing it
          back on the downbeat is a drop you performed rather than one the producer wrote. Cutting
          it on the last beat before a chorus is a hesitation the crowd feels. These are
          performances, and they are the reason the control is a knob you can grab rather than a
          menu.
        </p>
        <p>
          <strong>To hear two tracks separately.</strong> Killing the mids on one deck lets you hear
          its rhythm section against the other track's full arrangement, which is useful while you
          are lining something up and instantly reversible.
        </p>

        <h2>A transition, knob by knob</h2>
        <p>
          Concretely, then. Track A is playing. Track B is cued, gain set, beatmatched, waiting at
          the top of a phrase. Here is the whole move.
        </p>
        <ul>
          <li>
            <strong>Before you start:</strong> kill the low band on deck B. Nothing below 250 Hz is
            going to arrive when you press play.
          </li>
          <li>
            <strong>Start B on the downbeat</strong> of a phrase and bring its fader up. What
            arrives is the top and middle of the track over track A's full arrangement. It sits on
            top rather than fighting.
          </li>
          <li>
            <strong>Let it run for eight or sixteen bars.</strong> This is the part beginners rush.
            Both tracks are audible, the mix is not muddy, and there is no hurry.
          </li>
          <li>
            <strong>On a phrase boundary, swap the lows:</strong> A's low band down as B's comes
            up. This is the moment the transition actually happens - the bass changing hands is what
            the ear reads as the new track taking over.
          </li>
          <li>
            <strong>Then take A out</strong> with the crossfader or its fader, and return every
            band on B to neutral.
          </li>
        </ul>
        <p>
          The whole thing is one deliberate move on a boundary, wrapped in two quiet ones. Practise
          the swap on its own, without the rest, until it lands on the beat without thinking.
        </p>

        <h2>The curve changes what these are for</h2>
        <p>
          The isolator and the crossfader curve are more connected than they look. On a long, gentle
          curve, both decks are audible across most of the fader's travel, so band control is doing
          the work of keeping them out of each other's way - that is the blend described above.
        </p>
        <p>
          On a sharp curve, where the far deck stays silent until you are nearly across, blending is
          not what is happening at all. There, the bands become rhythmic: cuts and kills timed to
          the beat, with the crossfader used as a switch rather than a fade. Same three knobs,
          completely different instrument.
        </p>
        <p>
          If your band moves feel like they are not doing much, check what the curve is set to
          before you change anything else. You may be playing one technique on the other one's
          setting.
        </p>

        <h2>The mid knob is the one to be careful with</h2>
        <p>
          Cutting mids feels dramatic and is almost always a mistake outside of a specific effect.
          Because the band is so wide, killing it removes the vocal, the snare body, the guitars and
          most of the identity of the track at once. What is left is a bassline and some hi-hats,
          which is fine for a bar and hollow for eight.
        </p>
        <p>
          If a transition sounds crowded in the middle, the fix is usually the fader or the
          arrangement - pick a section with fewer elements - rather than removing the middle of the
          spectrum from one of the tracks.
        </p>

        <h2>Three ways it goes wrong</h2>
        <p>
          <strong>Leaving a band cut and forgetting.</strong> By far the most common. You kill the
          lows for a transition, get busy with the next track, and play four minutes of a record
          with no bass while wondering why the room went flat. Returning every band to neutral is
          the last step of every transition, not an optional tidy-up.
        </p>
        <p>
          <strong>Cutting on both decks at once.</strong> If the low band is down on A and down on
          B, there is no bass anywhere. The move is a <em>swap</em> - one goes down as the other
          comes up - not two independent cuts that happen to overlap.
        </p>
        <p>
          <strong>Using them because they are there.</strong> A transition with no band movement at
          all is completely fine if the two tracks already fit. These are tools for a specific
          problem - two arrangements competing for the same space - and applying them to a problem
          you do not have makes the mix worse, not more sophisticated.
        </p>

        <h2>Practise them as gestures</h2>
        <p>
          Because these are performance controls, practise them the way you would practise a
          gesture: on one track, with no mixing involved. Loop eight bars and spend five minutes
          killing and returning the low band on different beats. Learn what a bar without bass
          actually feels like, and how long is too long.
        </p>
        <p>
          Small precise moves you can make without looking beat large improvised ones every time.
          These knobs reward being played rather than being set.
        </p>
      </>
    ),
  },
];

/** Slug lookup for the reader. */
export function findPost(slug: string): Post | undefined {
  return POSTS.find((post) => post.slug === slug);
}
