"use strict"

import { DeviceService } from "~services/device.service"
import { KeyService } from "~services/key.service"
import { PasswordService } from "~services/password.service"

import { CryptoService } from "../services/crypto.service"

export {}

console.log("background.js is working")

chrome.runtime.onMessageExternal.addListener(async function (req, sender, res) {
  if (req.type === "SEND_DATA") {
    if (req.access_token) {
      // use req.password to encrypt later
      const { salt, initializationVector, cipherText } =
        await CryptoService.encryptMessage(req.access_token, "11111111")

      const enc_token = CryptoService.concatenateData(
        cipherText,
        initializationVector,
        salt
      )

      chrome.storage.local.set({ enc_token: enc_token }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error setting token:", chrome.runtime.lastError)
          res({ success: false })
        }
      })

      if (req.salt) {
        chrome.storage.local.set({ salt: req.salt }, () => {
          if (chrome.runtime.lastError) {
            console.error("Error setting salt:", chrome.runtime.lastError)
            res({ success: false })
          }
        })
      }

      res({ success: true })

      return true
    } else {
      res({ success: false })
    }
  } else if (req.type === "REQUEST_DEVICE_ID") {
    try {
      const deviceID = DeviceService.generateDeviceId()
      chrome.storage.local.set({ device_id: deviceID }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error setting deviceID:", chrome.runtime.lastError)
          res({ success: false, deviceID: "" })
        } else {
          console.log("DeviceID saved successfully")
          res({ success: true, deviceID: deviceID })
        }
      })
      res({ success: true, deviceID: deviceID })
    } catch (error) {
      console.error("Error generating device ID:", error)
      res({ success: false, deviceID: "" })
    }
  } else if (req.type === "REQUEST_HASH_PASSWORD") {
    try {
      let existingSalt: string
      if (req.salt) {
        existingSalt = req.salt
      } else {
        const getSalt = (salt: string): Promise<string> => {
          return new Promise((resolve, reject) => {
            chrome.storage.session.get(salt, (result) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError)
              } else {
                resolve(result[salt])
              }
            })
          })
        }

        existingSalt = await getSalt("salt")
      }
      const { key: hashPassword, salt: salt } = await PasswordService.deriveKey(
        req.password,
        existingSalt
      )

      const exportedKey = await self.crypto.subtle.exportKey(
        "raw",
        hashPassword
      )
      const base64Key = Buffer.from(exportedKey).toString("base64")

      res({ success: true, password: base64Key, salt: salt })
    } catch (error) {
      console.error("Error hashing password:", error)
      res({ success: false, password: "", salt: "" })
    }
  } else if (req.type === "REQUEST_KEY_PAIR") {
    try {
      const { privateKey: privateKey, publicKey: publicKey } =
        await KeyService.generateKeyPair()
      res({ success: true, privateKey: privateKey, publicKey: publicKey })
    } catch (error) {
      res({ success: false, privateKey: "", publicKey: "" })
    }
  } else if (req.type === "REQUEST_ENCRYPT") {
    try {
      if (req.password) {
        const { salt, initializationVector, cipherText } =
          await CryptoService.encryptMessage(req.key, req.password)

        res({
          success: true,
          cipherText: cipherText,
          salt,
          initializationVector
        })
      } else {
        chrome.storage.session.get("password", async (result) => {
          if (chrome.runtime.lastError) {
            console.error("Error getting password:", chrome.runtime.lastError)
            res({
              success: false,
              cipherText: "",
              salt: "",
              initializationVector: ""
            })
          } else {
            const { salt, initializationVector, cipherText } =
              await CryptoService.encryptMessage(req.key, result.password)

            res({
              success: true,
              cipherText: cipherText,
              salt: salt,
              initializationVector: initializationVector
            })
          }
        })
      }
    } catch (error) {
      console.error("Error encrypt key:", error)
      res({
        success: false,
        cipherText: "",
        salt: "",
        initializationVector: ""
      })
    }
  } else if (req.type === "REQUEST_TAB_INFO") {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0]
        res({
          success: true,
          title: activeTab.title,
          favicon: activeTab.favIconUrl
        })
      })
    } catch (error) {
      res({
        success: false
      })
    }
    return true
  } else if (req.type === "REQUEST_DECRYPT") {
    try {
      const getSessionData = (key: string): Promise<string> => {
        return new Promise((resolve, reject) => {
          chrome.storage.session.get(key, (result) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError)
            } else {
              resolve(result[key])
            }
          })
        })
      }
      const password: string = await getSessionData("password")

      if (req.text) {
        if (req.type_creds && req.type_creds === "personal_item") {
          const [initializationVector, salt, cipherText] =
            req.concatStr.split("::")
          if (!initializationVector || !salt || !cipherText) {
            throw new Error("Invalid credentials format")
          }

          const plainText = await CryptoService.decryptMessage(
            { salt, initializationVector, cipherText },
            password
          )

          if (plainText) {
            res({ success: true, plaintext: plainText })
          } else {
            res({ success: false })
          }
        } else if (req.type_creds && req.type_creds === "shared_item") {
          if (!req.enc_pri) {
            throw new Error("Invalid credential")
          }
          let [initializationVector, salt, cipherText] = req.enc_pri.split("::")

          const dec_pri = await CryptoService.decryptMessage(
            { salt, initializationVector, cipherText },
            password
          )
          ;[initializationVector, salt, cipherText] = req.text.split("::")

          const plainText = await CryptoService.decryptMessage(
            { salt, initializationVector, cipherText },
            dec_pri
          )

          if (plainText) {
            res({ success: true, plaintext: plainText })
          } else {
            res({ success: false })
          }
        }
      }
    } catch (error) {
      res({
        success: false
      })
    }
    return true
  } else {
    res({ success: false })
  }
})

chrome.runtime.onSuspend.addListener(() => {
  chrome.storage.session.clear(() => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError)
    } else {
      console.log("Session storage cleared")
    }
  })
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSessionToken") {
    chrome.storage.session.get([request.key], function (result) {
      sendResponse({ value: result[request.key] })
    })
  } else if (request.action === "getLocalToken") {
    chrome.storage.local.get([request.key], function (result) {
      sendResponse({ value: result[request.key] })
    })
  }
  return true
})
