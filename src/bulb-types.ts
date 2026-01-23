// BulbState defines the properties of the smart bulb that can be recorded and replayed.
export interface BulbState {
  on: boolean; // true if bulb is on
  brightness: number; // 0-100
  color?: string; // hex or color name, optional if bulb is white only
  temperature?: number; // color temperature in Kelvin, optional
}

// BulbStateSequenceItem represents a single step in the sequence.
export interface BulbStateSequenceItem {
  state: BulbState;
  timestamp: number; // ms since start of recording
}

// BulbStateSequence is the full sequence to be replayed.
export interface BulbStateSequence {
  steps: BulbStateSequenceItem[];
  recordedAt: string; // ISO date string
  label?: string; // optional user label
}
