'use client';

import { addressParts } from '../lib/address-parts.mjs';
import AddressCopy from './AddressCopy';

/** Wallet addresses in prose use the same copy control as wallet settings. */
export default function AddressText({ text, addresses = [] }) {
  return addressParts(text, addresses).map((part, index) => part.address
    ? <AddressCopy key={`${index}-${part.address}`} address={part.address} inline />
    : <span key={index}>{part.text}</span>);
}
