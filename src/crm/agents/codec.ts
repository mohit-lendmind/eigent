// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

// The wire codec for lendmind-typed artifacts. An envelope or log entry is
// carried inside a generic aion attachment, so it is JSON serialised, UTF-8
// encoded, then base64'd for AttachmentUpload.data_base64. Read back the other
// way. Chunked to survive documents larger than the call-stack limit of a
// spread String.fromCharCode.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** JSON → base64 UTF-8, for AttachmentUpload.data_base64. */
export function encodeJsonAttachment(value: unknown): string {
  return bytesToBase64(encoder.encode(JSON.stringify(value)));
}

/** The inline text an edge returns for a JSON artifact, parsed back to a value. */
export function decodeJsonContent(content: string): unknown {
  return JSON.parse(content);
}

/** base64 UTF-8 → string, for when only the raw bytes are to hand. */
export function decodeBase64Utf8(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return decoder.decode(bytes);
}
