import type { ColorValue } from "react-native";
import Svg, { Text as SvgText } from "react-native-svg";

/**
 * The Fenix brand mark for compact native headers. The component name stays
 * stable while the visible mark follows the fork branding.
 */
export function T3Wordmark(props: { readonly height: number; readonly color: ColorValue }) {
  const aspectRatio = 98 / 28;
  return (
    <Svg
      accessibilityLabel="Fenix"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 98 28"
    >
      <SvgText
        fill={props.color}
        fontFamily="DMSans-Bold"
        fontSize={24}
        fontWeight="700"
        letterSpacing={-0.4}
        x={0}
        y={22}
      >
        Fenix
      </SvgText>
    </Svg>
  );
}
