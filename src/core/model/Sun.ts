const SUNRISE = 6
const SUNSET = 18
const MAX_ALTITUDE = Math.PI / 3

/** Modelo simple de sol: altitud y azimut en función de la hora del día. */
export class Sun {
  /** Altitud en radianes: 0 fuera de las horas de luz, máxima a mediodía. */
  static altitude(timeOfDay: number): number {
    if (timeOfDay <= SUNRISE || timeOfDay >= SUNSET) return 0
    return Math.sin((Math.PI * (timeOfDay - SUNRISE)) / (SUNSET - SUNRISE)) * MAX_ALTITUDE
  }

  /** Azimut en radianes: barrido de este a oeste a lo largo del día. */
  static azimuth(timeOfDay: number): number {
    return (Math.PI * (timeOfDay - SUNRISE)) / (SUNSET - SUNRISE) - Math.PI / 2
  }
}
