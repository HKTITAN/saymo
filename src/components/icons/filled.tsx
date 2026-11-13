import type { ComponentProps } from "react";
import { Grid, Phone, Video } from "reicon-react";

// The few places that mark a selected or emphasised state use Reicon's Filled weight.
export const GridDashboard02SolidIcon = (props: ComponentProps<typeof Grid>) => <Grid weight="Filled" {...props} />;
export const PhoneSolidIcon = (props: ComponentProps<typeof Phone>) => <Phone weight="Filled" {...props} />;
export const VideoCallSolidIcon = (props: ComponentProps<typeof Video>) => <Video weight="Filled" {...props} />;
