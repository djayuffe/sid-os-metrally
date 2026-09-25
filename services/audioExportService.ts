
export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numChannels = buffer.numberOfChannels; // Support Stereo if buffer has it
  const sampleRate = buffer.sampleRate;
  const format = 3; // IEEE Float
  const bitDepth = 32;

  // Interleave channels
  const length = buffer.length * numChannels;
  const data = new Float32Array(length);
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      data[i * numChannels + ch] = buffer.getChannelData(ch)[i];
    }
  }

  const dataByteLength = length * 4;
  const bufferLength = 44 + dataByteLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 4, true); // Byte rate
  view.setUint16(32, numChannels * 4, true); // Block align
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    view.setFloat32(offset, data[i], true);
    offset += 4;
  }
  return new Blob([view], { type: 'audio/wav' });
};
