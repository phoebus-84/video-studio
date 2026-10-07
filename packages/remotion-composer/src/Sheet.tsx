// The layout sheet's grid (avg-3th.1): the stills of a timeline, in order,
// each with its number, time and label underneath, drawn by the same engine
// that rendered them. One frame; its size is the grid's.

import React from 'react';
import {AbsoluteFill, Img} from 'remotion';

export const CAPTION_HEIGHT = 40;

export interface SheetTile {
  /** A data: URL of the still. */
  src: string;
  caption: string;
}

export interface SheetProps {
  tiles: SheetTile[];
  columns: number;
  tileWidth: number;
  tileHeight: number;
  /** Index signature Remotion's Composition requires of its props. */
  [key: string]: unknown;
}

/** Width and height of the sheet's single frame. */
export const sheetSize = ({tiles, columns, tileWidth, tileHeight}: SheetProps) => ({
  width: columns * tileWidth,
  height: Math.max(1, Math.ceil(tiles.length / columns)) * (tileHeight + CAPTION_HEIGHT),
});

export const Sheet: React.FC<SheetProps> = ({tiles, columns, tileWidth, tileHeight}) => (
  <AbsoluteFill style={{backgroundColor: '#111', display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', width: columns * tileWidth}}>
    {tiles.map((tile, i) => (
      <div key={i} style={{width: tileWidth, height: tileHeight + CAPTION_HEIGHT, boxSizing: 'border-box', borderRight: '1px solid #333', borderBottom: '1px solid #333'}}>
        <Img src={tile.src} style={{display: 'block', width: '100%', height: tileHeight - 1, objectFit: 'contain'}} />
        <div style={{height: CAPTION_HEIGHT, lineHeight: `${CAPTION_HEIGHT}px`, padding: '0 8px', color: '#eee', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
          {tile.caption}
        </div>
      </div>
    ))}
  </AbsoluteFill>
);
