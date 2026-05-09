export const basicMotionStdlib = `@motion fade-in(dur=0.5s, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

@motion fade-out(dur=0.5s, ease=ease-in)
  opacity: 1 -> 0 over $dur $ease

@motion slide-right(from, to, dur=1s, ease=ease-out)
  x: $from -> $to over $dur $ease

@motion slide-left(from, to, dur=1s, ease=ease-out)
  x: $from -> $to over $dur $ease

@motion slide-down(from, to, dur=1s, ease=ease-out)
  y: $from -> $to over $dur $ease

@motion slide-up(from, to, dur=1s, ease=ease-out)
  y: $from -> $to over $dur $ease

@motion scale-in(dur=0.5s, ease=ease-out)
  scale: 0 -> 1 over $dur $ease

@motion scale-out(dur=0.5s, ease=ease-in)
  scale: 1 -> 0 over $dur $ease

@motion pulse(dur=0.8s, ease=ease-in-out)
  scale: 1 -> 1.08 -> 1 over $dur $ease

@motion drift-x(speed)
  x: f(t) = $speed * t
`;

