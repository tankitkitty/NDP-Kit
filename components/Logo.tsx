export default function Logo({ size = 52 }: { size?: number }) {
  return (
    <div className="logo-mark" style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <svg
        width={size * 0.5}
        height={size * 0.5}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
          fill="white"
          fillOpacity="0.95"
        />
        <path
          d="M14 2v5h5"
          fill="none"
          stroke="var(--button)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <text
          x="12"
          y="16.5"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          letterSpacing="-0.3"
          fill="var(--button)"
        >
          13
        </text>
      </svg>
    </div>
  );
}
