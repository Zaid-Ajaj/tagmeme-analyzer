import { Option, Result } from './types'

const color = Option.Some('green')

// Correct usage, no errors
const colorValue = Option.match(color, {
    Some: colorName => colorName, 
    None: () => 'blue'
});

// Type name misspelled: 'Option' => 'Opion'
const otherValue = Opion.match(color, {
    Some: colorName => colorName, 
    None: () => 'blue'
});

// Error misspelled => 'Erro'
const firstResult = Result.match(Result.Ok('success'), {
    Ok: value => value, 
    Erro: () => 'blue'
});

// Handling too many cases, case 'Other' is not declared
const secondResult = Result.match(Result.Ok('success'), {
    Ok: value => value, 
    Error: () => 'blue', 
    Other: () => 'too many cases handled'
});

// redundant catchAll argument
const withCatchAll = Option.match(color, {
    Some: colorName => colorName, 
    None: () => 'blue'
}, () => "default-color");