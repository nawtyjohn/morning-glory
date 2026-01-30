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

// DaysOfWeek flag enum for sequence scheduling
export enum DaysOfWeek {
  Sunday = 1 << 0,    // 1
  Monday = 1 << 1,    // 2
  Tuesday = 1 << 2,   // 4
  Wednesday = 1 << 3, // 8
  Thursday = 1 << 4,  // 16
  Friday = 1 << 5,    // 32
  Saturday = 1 << 6,  // 64
}

// BulbStateSequence is the full sequence to be replayed.
export interface BulbStateSequence {
  steps: BulbStateSequenceItem[];
  recordedAt: string; // ISO date string
  label?: string; // optional user label
  daysOfWeek?: number; // bitflag of DaysOfWeek enum values indicating which days the sequence runs
}
