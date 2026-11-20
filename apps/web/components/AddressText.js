'use client';

import { addressTextParts } from '../lib/address-labels.mjs';
import AddressCopy from './AddressCopy';

export default function AddressText({ text, addresses = [], renderText = value => value }) {
  return addressTextParts(text, addresses).map((part, index) => part.address
    ? <AddressCopy key={index} address={part.address} inline />
    : <span key={index}>{renderText(part.text)}</span>);
}
