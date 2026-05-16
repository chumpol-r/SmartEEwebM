const ENCODEKEY = "SMARTEE";
const STR_SAULT = "Q!w2E#r4T%y6U&i8O(p0{_]=";
const CHR_REPLACE_QUOTE = "<10>";

function Decrypt(strSource) {
    if (!strSource) return "";

    try {
        console.log('[Decrypt] Input length:', strSource.length);

        // Additional function
        strSource = strSource.replace(new RegExp(CHR_REPLACE_QUOTE, 'g'), "'");

        // Remove the last dummy character
        strSource = strSource.substring(0, strSource.length - 1);

        let lLen = strSource.length;
        console.log('[Decrypt] After removing last char, length:', lLen);

        let strDec3 = new Array(lLen).fill(' ');

        // Third decryption (Unshuffle)
        let i = 1; // 1-based index logic from VB
        let j = 1;

        // In JS strings are 0-indexed, so we adjust
        // VB: Mid(strDec3, i, 1) = Mid(strSource, j, 1)
        // JS: strDec3[i-1] = strSource[j-1]

        while (i <= lLen) {
            strDec3[i - 1] = strSource[j - 1];
            i += 2;
            j += 1;
        }
        i = 2;
        while (i <= lLen) {
            strDec3[i - 1] = strSource[j - 1];
            i += 2;
            j += 1;
        }

        strDec3 = strDec3.join('');

        // Second decryption
        let strDec2 = strDec3.substring(0, 2);
        for (i = 3; i <= lLen; i++) {
            let charCode = strDec3.charCodeAt(i - 1) - strDec3.charCodeAt(0); // Asc(Mid(strDec3, i, 1)) - Asc(Mid(strDec3, 1, 1))

            if (charCode < 32) {
                charCode = 126 - (31 - charCode);
                if (charCode < 32) {
                    charCode = 126 - (31 - charCode);
                }
            }
            strDec2 += String.fromCharCode(charCode);
        }

        // First decryption
        let strDec1 = "";
        lLen = strDec2.length;
        let lSault = 1;
        let strChilli = ENCODEKEY + STR_SAULT;

        for (i = 1; i <= lLen; i++) {
            let charCode = strDec2.charCodeAt(i - 1) - strChilli.charCodeAt(lSault - 1);

            if (charCode < 32) {
                charCode = 126 - (31 - charCode);
                if (charCode < 32) {
                    charCode = 126 - (31 - charCode);
                }
            }

            strDec1 += String.fromCharCode(charCode);
            lSault = (lSault % strChilli.length) + 1;
        }

        // Decapsulate real length
        // VB: lRealLen = CLng(Mid(strDec1, 3, 3))
        // JS: parseInt(strDec1.substring(2, 5))
        let lRealLen = parseInt(strDec1.substring(2, 5));
        console.log('[Decrypt] Real length from data:', lRealLen);

        // VB: If Mid(strDec1, 6 + lRealLen, Len(strSault)) <> strSault Then
        let checkSault = strDec1.substring(5 + lRealLen, 5 + lRealLen + ENCODEKEY.length);
        console.log('[Decrypt] Check salt:', checkSault, 'Expected:', ENCODEKEY);

        if (checkSault !== ENCODEKEY) {
            console.log('[Decrypt] Salt mismatch - returning empty');
            return "";
        } else {
            // VB: strDec1 = Mid(strDec1, 6, lRealLen)
            const result = strDec1.substring(5, 5 + lRealLen);
            console.log('[Decrypt] SUCCESS - Result:', result);
            return result;
        }

    } catch (ex) {
        console.error("[Decrypt] Exception:", ex.message);
        return "";
    }
}

function Encrypt(strSource) {
    // Basic implementation for session tokens, might not match VB exactly due to Rnd()
    // But sufficient for new session generation if we use our own Decrypt
    if (!strSource) strSource = "";

    // For now, let's just return a simple base64 for session if we don't need DB compatibility for WRITES
    // If we need DB compatibility, we need to implement the full logic.
    // Given the complexity and Rnd(), let's try to implement it as best as possible.

    try {
        let strSault = ENCODEKEY;
        let ENC_STEP = 24;

        // Encapsulate
        // VB: Chr(Int(94 * Rnd() + 32))
        const rndChar = () => String.fromCharCode(Math.floor(Math.random() * 94) + 32);

        let prefix = rndChar() + rndChar();
        let lenStr = ("000" + strSource.length).slice(-3);

        strSource = prefix + lenStr + strSource + strSault;

        if (strSource.length % ENC_STEP !== 0) {
            let padding = ENC_STEP - (strSource.length % ENC_STEP) - 1;
            let ch = rndChar();
            strSource += ch.repeat(padding);
        }

        // First Encryption
        let strEnc1 = "";
        let lLen = strSource.length;
        let lSault = 1;
        let lXor = 0;
        let lPlus = 0;
        let strChilli = strSault + STR_SAULT;

        for (let i = 1; i <= lLen; i++) {
            let lCode = strSource.charCodeAt(i - 1) + strChilli.charCodeAt(lSault - 1);

            if (lCode > 126) {
                lCode = 31 + (lCode - 126);
                if (lCode > 126) lCode = 31 + (lCode - 126);
            }

            strEnc1 += String.fromCharCode(lCode);
            lXor = lXor ^ lCode;
            lPlus = lPlus + lCode;

            lSault = (lSault % strChilli.length) + 1;
        }

        // Second Encryption
        lXor = Math.abs(lXor + lPlus) % 126;
        if (lXor < 32) lXor += 32;

        // VB: strEnc1 = Chr(lXor) & Right(strEnc1, Len(strEnc1) - 1)
        strEnc1 = String.fromCharCode(lXor) + strEnc1.substring(1);

        let strEnc2 = strEnc1.substring(0, 2);
        for (let i = 3; i <= lLen; i++) {
            let lCode = strEnc1.charCodeAt(i - 1) + strEnc1.charCodeAt(0);
            if (lCode > 126) {
                lCode = 31 + (lCode - 126);
                if (lCode > 126) lCode = 31 + (lCode - 126);
            }
            strEnc2 += String.fromCharCode(lCode);
        }

        // Third Encryption (Shuffle)
        let strEnc3 = "";
        let i = 1;
        while (i <= lLen) {
            strEnc3 += strEnc2[i - 1];
            i += 2;
        }
        i = 2;
        while (i <= lLen) {
            strEnc3 += strEnc2[i - 1];
            i += 2;
        }

        let lastChar = rndChar();
        while (lastChar === ' ') lastChar = rndChar();

        let result = strEnc3 + lastChar;
        return result.replace(/'/g, CHR_REPLACE_QUOTE);

    } catch (ex) {
        console.error("Encrypt error:", ex);
        return "";
    }
}

// Token-safe versions using Base64 encoding
function EncryptToken(strSource) {
    const encrypted = Encrypt(strSource);
    // Convert to base64 for safe transport (no special chars)
    return Buffer.from(encrypted, 'utf-8').toString('base64');
}

function DecryptToken(base64Token) {
    try {
        // Decode from base64 first
        const encrypted = Buffer.from(base64Token, 'base64').toString('utf-8');
        return Decrypt(encrypted);
    } catch (ex) {
        console.error("DecryptToken error:", ex.message);
        return "";
    }
}

module.exports = { Decrypt, Encrypt, EncryptToken, DecryptToken };
