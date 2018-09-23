import { union as makeUnion } from 'tagmeme'
export const Numbers = makeUnion([ 'One', 'Two', 'match' ]);
export const Option = makeUnion([ 'Some', 'None' ]);
export const Result = makeUnion([ 'Ok', 'Error' ]);
export const Deplicates = makeUnion([ 'First', 'First' ]);