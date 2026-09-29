/** Root component. Importing the module registry registers the four editors. */
import './modules';
import { Shell } from './shell/Shell';

export function App() {
  return <Shell />;
}
