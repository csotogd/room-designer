/** Las novedades siguen el final solo mientras el usuario lo esté leyendo. */
export class ConversationScroll {
  private following = true

  constructor(private readonly messages: HTMLElement) {
    messages.addEventListener('scroll', () => {
      this.following = messages.scrollHeight - messages.clientHeight - messages.scrollTop <= 40
    })
  }

  afterAppend(): void {
    if (this.following) this.messages.scrollTop = this.messages.scrollHeight
  }
}
