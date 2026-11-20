'use client';

import { addressTextParts } from '../lib/address-labels.mjs';
import AddressCopy from './AddressCopy';

export default function AddressText({ text, addresses = [], renderText = value => value }) {
  return addressTextParts(text, addresses).map((part, index) => part.address
    ? part.punctuation
      ? <span key={index} className="address-copy-token"><AddressCopy address={part.address} inline />{part.punctuation}</span>
      : <AddressCopy key={index} address={part.address} inline />
    : <span key={index} className={part.punctuation ? 'address-copy-token' : undefined}>{renderText(part.text)}{part.punctuation}</span>);
}
