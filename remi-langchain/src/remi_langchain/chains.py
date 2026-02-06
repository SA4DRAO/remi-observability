from __future__ import annotations

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, PromptTemplate


def build_offline_chain():
    """Build a deterministic offline chain for testing without network access."""
    from langchain_community.llms import FakeListLLM

    prompt = PromptTemplate.from_template(
        (
            "You are a sentiment analyzer. Classify the sentiment (Positive, Negative, Neutral) "
            "and provide a short one-line justification.\n\n"
            "Text: {text}\n"
            "Answer in the format: \"Sentiment: <label> | Justification: <short reason>\"."
        )
    )

    llm = FakeListLLM(
        responses=[
            "Sentiment: Positive | Justification: The wording expresses satisfaction and optimism.",
        ]
    )
    return prompt | llm | StrOutputParser()


def build_openai_chain(model_name: str = "gpt-4o-mini", temperature: float = 0.0, streaming: bool = True):
    """Build an OpenAI chat model chain."""
    from langchain_openai import ChatOpenAI

    prompt = ChatPromptTemplate.from_template(
        (
            "You are a sentiment analyzer. Classify the sentiment (Positive, Negative, Neutral) "
            "and provide a concise justification.\n\n"
            "Text: {text}\n"
            "Answer in the format: \"Sentiment: <label> | Justification: <short reason>\"."
        )
    )

    chat = ChatOpenAI(model=model_name, temperature=temperature, streaming=streaming)
    return prompt | chat | StrOutputParser()