
import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';

const EPSILON = 1e-10;

// ============================================================================
// NMOS TRANSISTOR-LEVEL WAVEFORM GENERATION
// ============================================================================

class NMOSWaveformDAC {
    constructor() {
        this.transistors = Array(12).fill(0).map(() => ({
            vgs: 0,
            vds: 0,
            ids: 0,
            state: 'off'
        }));
        this.outputVoltage = 0;
        this.outputCurrent = 0;
    }

    computeTransistorCurrent(vgs, vds) {
        if (vgs < NMOS_VTH) {
            return NMOS_LEAKAGE * Math.exp(Math.max(-20, (vgs - NMOS_VTH) / 0.026));
        }

        const vgs_vth = vgs - NMOS_VTH;

        if (vds < vgs_vth) {
            return NMOS_BETA * ((vgs_vth * vds) - (0.5 * vds * vds)) * (1 + NMOS_LAMBDA * vds);
        } else {
            return 0.5 * NMOS_BETA * vgs_vth * vgs_vth * (1 + NMOS_LAMBDA * vds);
        }
    }

    computeOutput(digitalValue, activeWaveforms) {
        let totalCurrent = 0;
        let totalConductance = 0;

        for (let bit = 0; bit < 12; bit++) {
            const isOn = (digitalValue >> bit) & 1;
            const weight = Math.pow(2, bit);

            const vgs = isOn ? NMOS_VDD : 0;
            const vds = Math.max(0, NMOS_VDD - this.outputVoltage);

            this.transistors[bit].vgs = vgs;
            this.transistors[bit].vds = vds;
            const ids = this.computeTransistorCurrent(vgs, vds);
            this.transistors[bit].ids = isFinite(ids) ? ids : 0;

            if (isOn) {
                totalCurrent += this.transistors[bit].ids * weight;
                totalConductance += NMOS_BETA * weight;
            }
        }

        if (activeWaveforms > 1) {
            const fightingFactor = 1.0 / Math.pow(Math.max(1, activeWaveforms), 0.7);
            totalCurrent *= fightingFactor;
        }

        const denom = totalConductance + 0.01;
        this.outputVoltage = NMOS_VDD - (totalCurrent / Math.max(EPSILON, denom));

        if (!isFinite(this.outputVoltage)) this.outputVoltage = 0;
        return (this.outputVoltage / NMOS_VDD) * 2.0 - 1.0;
    }
}

// Global Consts
const NMOS_VDD = 5.0;
const NMOS_VTH = 1.5;
const NMOS_BETA = 0.05;
const NMOS_LAMBDA = 0.02;
const NMOS_LEAKAGE = 0.001;

// ... (Rest of engine code remains valid with internal finite checks)
