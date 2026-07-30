import React from "react";
import {Composition} from "remotion";
import {SeaBattleGrantFilm} from "./SeaBattleGrantFilm";

export const VIDEO_FPS = 30;
export const VIDEO_DURATION = 2040;

export const VideoRoot: React.FC = () => {
  return (
    <Composition
      id="SeaBattleGrantFilm"
      component={SeaBattleGrantFilm}
      durationInFrames={VIDEO_DURATION}
      fps={VIDEO_FPS}
      width={1920}
      height={1080}
    />
  );
};
