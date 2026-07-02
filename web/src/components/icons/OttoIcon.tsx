import { forwardRef, type SVGProps } from "react";

const conductMarkPath =
  "M27.735 0H11.426C11.261 0 11.126 0.134 11.126 0.298V2.757C11.126 2.922 11.261 3.056 11.426 3.056H27.735C27.901 3.056 28.036 2.922 28.036 2.757V0.299C28.036 0.134 27.901 0 27.735 0ZM20.612 5.24H3.859C3.693 5.24 3.558 5.374 3.558 5.538V7.997C3.558 8.162 3.693 8.296 3.859 8.296H20.612C20.778 8.296 20.912 8.162 20.912 7.997V5.538C20.912 5.374 20.778 5.24 20.612 5.24ZM17.054 10.481H0.3C0.134 10.481 0 10.615 0 10.779V13.238C0 13.403 0.134 13.537 0.3 13.537H17.054C17.22 13.537 17.354 13.403 17.354 13.238V10.779C17.354 10.615 17.22 10.481 17.054 10.481ZM20.168 15.726H3.859C3.693 15.726 3.558 15.86 3.558 16.025V18.484C3.558 18.649 3.693 18.782 3.859 18.782H20.168C20.334 18.782 20.468 18.649 20.468 18.484V16.025C20.468 15.86 20.334 15.726 20.168 15.726ZM27.735 20.964H11.426C11.261 20.964 11.126 21.097 11.126 21.262V23.721C11.126 23.886 11.261 24.019 11.426 24.019H27.735C27.901 24.019 28.036 23.886 28.036 23.721V21.262C28.036 21.097 27.901 20.964 27.735 20.964Z";

export const ConductMark = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function ConductMark(props, ref) {
    return (
      <svg ref={ref} viewBox="0 0 28.036 24.019" fill="none" aria-hidden="true" {...props}>
        <path d={conductMarkPath} fill="currentColor" />
      </svg>
    );
  },
);

export const ConductWordmark = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function ConductWordmark(props, ref) {
    return (
      <svg ref={ref} viewBox="0 0 128 28" fill="none" aria-hidden="true" {...props}>
        <path d={conductMarkPath} fill="currentColor" />
        <text
          x="36"
          y="20"
          fill="currentColor"
          fontFamily="ABC Diatype, Inter, ui-sans-serif, system-ui, sans-serif"
          fontSize="21"
          fontWeight="700"
          letterSpacing="0"
        >
          Conduct
        </text>
      </svg>
    );
  },
);

export const OttoIcon = ConductMark;
